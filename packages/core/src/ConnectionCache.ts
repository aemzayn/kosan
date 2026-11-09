import { createHash } from "node:crypto";
import type { Adapter, CacheOptions, TenantConfig } from "./types.js";

/**
 * One tenant's connection, whether it is still opening or ready.
 *
 * All bookkeeping is synchronous: a slot is registered, replaced or removed
 * without an `await` in between, so concurrent callers always see a
 * consistent cache. Closing connections happens in the background.
 */
interface SlotState<TConn> {
  tenantId: string;
  tenantSlug: string;
  /** Hash of the connection key the connection was opened with. */
  key: string;
  conn: TConn | undefined;
  /** Removed from the cache (evicted / replaced / shutdown) — must not be used. */
  detached: boolean;
  lastUsed: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface Slot<TConn> extends SlotState<TConn> {
  /** Resolves with the connection once open; shared by concurrent callers. */
  ready: Promise<TConn>;
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

/** Turns a stored tenant row into the config used to connect (e.g. decrypts the password). */
export type PrepareTenant = (tenant: TenantConfig) => Promise<TenantConfig>;

export class ConnectionCache<TConn> {
  /** Insertion order is LRU order: least recently used first. */
  private readonly slots = new Map<string, Slot<TConn>>();
  /** Background disconnects, awaited by disconnectAll(). */
  private readonly closing = new Set<Promise<void>>();
  readonly maxSize: number;
  private readonly idleTimeoutMs: number;
  private readonly adapter: Adapter<TConn>;

  constructor(adapter: Adapter<TConn>, options: CacheOptions = {}) {
    this.adapter = adapter;
    this.maxSize = options.maxSize ?? 100;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000;
  }

  /**
   * Returns the tenant's connection, opening it if needed.
   *
   * `tenant` is the stored row; `prepare` (e.g. credential decryption) only
   * runs when a new connection is actually opened, not on cache hits.
   * If the row's connection key changed since the connection was opened (new
   * host, rotated password, …), the stale connection is replaced.
   */
  getOrConnect(tenant: TenantConfig, prepare?: PrepareTenant): Promise<TConn> {
    const key = this.keyOf(tenant);
    const slot = this.slots.get(tenant.id);

    if (slot !== undefined && slot.key === key) {
      this.touch(slot);
      return slot.conn !== undefined ? Promise.resolve(slot.conn) : slot.ready;
    }

    if (slot !== undefined) this.detach(slot); // settings changed: replace it

    const state: SlotState<TConn> = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      key,
      conn: undefined,
      detached: false,
      lastUsed: Date.now(),
      timer: undefined,
    };
    const fresh: Slot<TConn> = Object.assign(state, { ready: this.open(state, tenant, prepare) });
    // Waiters may come and go; never surface an unhandled rejection from the shared promise.
    fresh.ready.catch(() => {});
    this.slots.set(tenant.id, fresh);
    return fresh.ready;
  }

  private async open(
    slot: SlotState<TConn>,
    tenant: TenantConfig,
    prepare?: PrepareTenant,
  ): Promise<TConn> {
    let conn: TConn;
    try {
      const config = prepare === undefined ? tenant : await prepare(tenant);
      conn = await this.adapter.connect(config);
    } catch (err) {
      // Failed connects are not cached, so the next request retries.
      if (this.slots.get(slot.tenantId) === slot) this.slots.delete(slot.tenantId);
      throw err;
    }

    if (slot.detached) {
      // Evicted or replaced while opening: this connection is stale.
      await this.adapter.disconnect(conn);
      throw new TenantEvictedError(slot.tenantSlug);
    }

    slot.conn = conn;
    this.touch(slot);
    this.enforceCapacity(slot);
    return conn;
  }

  /**
   * Removes a tenant's connection. Waits for an open connection to close; a
   * connection still being opened is closed by its own connect when it
   * finishes (so a slow or unreachable host never blocks the caller).
   * `disconnectAll()` waits for both.
   */
  async evict(tenantId: string): Promise<void> {
    const slot = this.slots.get(tenantId);
    if (slot === undefined) return;
    const wasOpen = slot.conn !== undefined;
    const closed = this.detach(slot);
    if (wasOpen) await closed;
  }

  /** Closes every connection, including ones still opening. */
  async disconnectAll(): Promise<void> {
    for (const slot of [...this.slots.values()]) this.detach(slot);
    await Promise.all([...this.closing]);
  }

  /** Number of open (ready) connections. */
  get size(): number {
    let n = 0;
    for (const slot of this.slots.values()) if (slot.conn !== undefined) n++;
    return n;
  }

  has(tenantId: string): boolean {
    return this.slots.get(tenantId)?.conn !== undefined;
  }

  stats(): CacheStats[] {
    const now = Date.now();
    return [...this.slots.values()]
      .filter((s) => s.conn !== undefined)
      .map((s) => ({
        tenantId: s.tenantId,
        tenantSlug: s.tenantSlug,
        lastUsed: s.lastUsed,
        idleMs: now - s.lastUsed,
      }));
  }

  // ---------------------------------------------------------------------------
  // Internals — all synchronous except the tracked background close
  // ---------------------------------------------------------------------------

  /**
   * Synchronously removes `slot` from the cache and starts closing it.
   * Returns a promise that settles once it is closed (never rejects).
   */
  private detach(slot: Slot<TConn>): Promise<void> {
    if (this.slots.get(slot.tenantId) === slot) this.slots.delete(slot.tenantId);
    clearTimeout(slot.timer);
    slot.timer = undefined;
    if (slot.detached) return Promise.resolve();
    slot.detached = true;

    // Ready: close now. Opening: open() sees `detached` and closes it itself.
    const closed =
      slot.conn !== undefined
        ? this.adapter.disconnect(slot.conn)
        : slot.ready.then(
            () => undefined,
            () => undefined,
          );
    const tracked = closed.catch(() => {});
    this.closing.add(tracked);
    void tracked.finally(() => this.closing.delete(tracked));
    return tracked;
  }

  /** Marks `slot` most recently used and restarts its idle timer. */
  private touch(slot: SlotState<TConn>): void {
    slot.lastUsed = Date.now();
    const current = this.slots.get(slot.tenantId);
    if (current === undefined || current !== slot) return; // detached meanwhile
    this.slots.delete(slot.tenantId);
    this.slots.set(slot.tenantId, current);
    if (slot.conn === undefined) return;

    clearTimeout(slot.timer);
    const timer = setTimeout(() => {
      if (this.slots.get(current.tenantId) === current) this.detach(current);
    }, this.idleTimeoutMs);
    // Don't keep the Node process alive just for cache cleanup.
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    slot.timer = timer;
  }

  /** Closes least-recently-used open connections until within maxSize. */
  private enforceCapacity(keep: SlotState<TConn>): void {
    let open = this.size;
    for (const slot of [...this.slots.values()]) {
      if (open <= this.maxSize) return;
      if (slot === keep || slot.conn === undefined) continue;
      this.detach(slot);
      open--;
    }
  }

  private keyOf(tenant: TenantConfig): string {
    const raw = this.adapter.connectionKey?.(tenant) ?? defaultConnectionKey(tenant);
    // Hashed so the cache never holds a second copy of credentials.
    return createHash("sha256").update(raw).digest("hex");
  }
}

/**
 * Default connection key: every field of the stored row except status and
 * timestamps, so any change an adapter might depend on (host, credentials,
 * meta used to build a URL, …) opens a fresh connection.
 */
function defaultConnectionKey(tenant: TenantConfig): string {
  const { status: _status, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = tenant;
  return stableStringify(rest);
}

/** JSON with object keys sorted at every level, so key order never matters. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
