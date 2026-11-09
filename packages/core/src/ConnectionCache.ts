import { createHash } from "node:crypto";
import type { Adapter, CacheOptions, TenantConfig } from "./types.js";

interface CacheEntry<TConn> {
  conn: TConn;
  /** Hash of the settings the connection was opened with (see `fingerprint`). */
  fingerprint: string;
  tenantId: string;
  tenantSlug: string;
  lastUsed: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** A connect() that has started but not finished, shared by concurrent callers. */
interface PendingConnect<TConn> {
  promise: Promise<TConn>;
  fingerprint: string;
  /** Set by evict()/disconnectAll(): the result must be closed, not cached. */
  state: { cancelled: boolean };
}

/** Thrown to callers waiting on a connect whose tenant was evicted meanwhile. */
export class TenantEvictedError extends Error {
  constructor(slug: string) {
    super(`Tenant "${slug}" was evicted while its connection was being opened`);
    this.name = "TenantEvictedError";
  }
}

export interface CacheStats {
  tenantId: string;
  tenantSlug: string;
  lastUsed: number;
  idleMs: number;
}

export class ConnectionCache<TConn> {
  private readonly entries = new Map<string, CacheEntry<TConn>>();
  private readonly pending = new Map<string, PendingConnect<TConn>>();
  /** Ordered least-recently-used → most-recently-used */
  private readonly lruOrder: string[] = [];
  readonly maxSize: number;
  private readonly idleTimeoutMs: number;
  private readonly adapter: Adapter<TConn>;

  constructor(adapter: Adapter<TConn>, options: CacheOptions = {}) {
    this.adapter = adapter;
    this.maxSize = options.maxSize ?? 100;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000;
  }

  async getOrConnect(tenant: TenantConfig): Promise<TConn> {
    const fp = fingerprint(tenant);

    const existing = this.entries.get(tenant.id);
    if (existing?.fingerprint === fp) {
      existing.lastUsed = Date.now();
      this.bumpLRU(tenant.id);
      this.resetTimer(existing);
      return existing.conn;
    }

    // Concurrent first requests for the same tenant share one connect().
    const inflight = this.pending.get(tenant.id);
    if (inflight?.fingerprint === fp) return inflight.promise;

    // Host, database or credentials changed since this connection was opened
    // (e.g. the tenant was moved by another process): drop the stale one.
    if (existing !== undefined || inflight !== undefined) await this.evict(tenant.id);

    const state = { cancelled: false };
    const promise = this.connectAndStore(tenant, state, fp);
    this.pending.set(tenant.id, { promise, state, fingerprint: fp });
    return promise;
  }

  private async connectAndStore(
    tenant: TenantConfig,
    state: { cancelled: boolean },
    fp: string,
  ): Promise<TConn> {
    let conn: TConn;
    try {
      conn = await this.adapter.connect(tenant);
    } finally {
      // Failed connects are not cached, so the next request retries.
      if (this.pending.get(tenant.id)?.state === state) this.pending.delete(tenant.id);
    }

    if (state.cancelled) {
      // Evicted mid-connect (credentials changed, suspended, shutdown):
      // this connection was opened from stale config, so close it.
      await this.adapter.disconnect(conn);
      throw new TenantEvictedError(tenant.slug);
    }

    // Enforce capacity at insert time so parallel connects cannot overshoot.
    while (this.entries.size >= this.maxSize && this.lruOrder.length > 0) {
      await this.evictLRU();
    }

    const entry: CacheEntry<TConn> = {
      conn,
      fingerprint: fp,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      lastUsed: Date.now(),
      timer: undefined,
    };
    this.entries.set(tenant.id, entry);
    this.lruOrder.push(tenant.id);
    this.resetTimer(entry);
    return conn;
  }

  async evict(tenantId: string): Promise<void> {
    const inflight = this.pending.get(tenantId);
    if (inflight) {
      inflight.state.cancelled = true;
      this.pending.delete(tenantId);
    }

    const entry = this.entries.get(tenantId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    this.entries.delete(tenantId);
    const idx = this.lruOrder.indexOf(tenantId);
    if (idx !== -1) this.lruOrder.splice(idx, 1);
    await this.adapter.disconnect(entry.conn);
  }

  async disconnectAll(): Promise<void> {
    const ids = [...new Set([...this.entries.keys(), ...this.pending.keys()])];
    await Promise.all(ids.map((id) => this.evict(id)));
  }

  get size(): number {
    return this.entries.size;
  }

  has(tenantId: string): boolean {
    return this.entries.has(tenantId);
  }

  stats(): CacheStats[] {
    const now = Date.now();
    return [...this.entries.values()].map((e) => ({
      tenantId: e.tenantId,
      tenantSlug: e.tenantSlug,
      lastUsed: e.lastUsed,
      idleMs: now - e.lastUsed,
    }));
  }

  private async evictLRU(): Promise<void> {
    const lruId = this.lruOrder[0];
    if (lruId !== undefined) await this.evict(lruId);
  }

  private bumpLRU(id: string): void {
    const idx = this.lruOrder.indexOf(id);
    if (idx !== -1) this.lruOrder.splice(idx, 1);
    this.lruOrder.push(id);
  }

  private resetTimer(entry: CacheEntry<TConn>): void {
    clearTimeout(entry.timer);
    const timer = setTimeout(() => {
      void this.evict(entry.tenantId);
    }, this.idleTimeoutMs);
    // Don't keep the Node process alive just for cache cleanup.
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    entry.timer = timer;
  }
}

/**
 * Identifies the settings a connection depends on. Hashed so the cache does
 * not keep a second plaintext copy of the password.
 */
function fingerprint(tenant: TenantConfig): string {
  const parts = [
    tenant.host,
    tenant.port,
    tenant.dbName,
    tenant.user,
    tenant.password,
    tenant.meta?.dialect,
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
