import type { Adapter, CacheOptions, TenantConfig } from "./types.js";

interface CacheEntry<TConn> {
  conn: TConn;
  tenantId: string;
  tenantSlug: string;
  lastUsed: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface CacheStats {
  tenantId: string;
  tenantSlug: string;
  lastUsed: number;
  idleMs: number;
}

export class ConnectionCache<TConn> {
  private readonly entries = new Map<string, CacheEntry<TConn>>();
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
    const existing = this.entries.get(tenant.id);
    if (existing) {
      existing.lastUsed = Date.now();
      this.bumpLRU(tenant.id);
      this.resetTimer(existing);
      return existing.conn;
    }

    if (this.entries.size >= this.maxSize) {
      await this.evictLRU();
    }

    const conn = await this.adapter.connect(tenant);
    const entry: CacheEntry<TConn> = {
      conn,
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
    const ids = [...this.entries.keys()];
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
