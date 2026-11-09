import type { TenantConfig } from "./types.js";

interface Entry {
  tenant: TenantConfig;
  expiresAt: number;
}

/**
 * Short-lived in-process cache of master-table rows, so resolving a tenant
 * does not query the master DB on every request.
 *
 * Rows are indexed by both id and slug. Only found tenants are cached;
 * unknown slugs always go to the master DB so new tenants resolve at once.
 * Writes made through this process invalidate immediately; writes made by
 * other processes become visible after at most `ttlMs`.
 *
 * `version` changes on every invalidation. Callers read it before querying
 * the master DB and pass it to `set()`, so a row read before a concurrent
 * write is never cached after that write invalidated it.
 */
export class TenantLookupCache {
  private readonly byId = new Map<string, Entry>();
  private readonly slugToId = new Map<string, string>();
  private currentVersion = 0;

  constructor(private readonly ttlMs: number) {}

  get version(): number {
    return this.currentVersion;
  }

  getBySlug(slug: string): TenantConfig | undefined {
    const id = this.slugToId.get(slug);
    return id === undefined ? undefined : this.getById(id);
  }

  getById(id: string): TenantConfig | undefined {
    const entry = this.byId.get(id);
    if (entry === undefined) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.drop(id);
      return undefined;
    }
    return entry.tenant;
  }

  /** Caches `tenant` unless an invalidation happened since `readAtVersion`. */
  set(tenant: TenantConfig, readAtVersion: number): void {
    if (this.ttlMs <= 0 || readAtVersion !== this.currentVersion) return;
    this.sweep();
    this.drop(tenant.id); // drops a stale slug mapping if the slug changed
    this.byId.set(tenant.id, { tenant, expiresAt: Date.now() + this.ttlMs });
    this.slugToId.set(tenant.slug, tenant.id);
  }

  /** Forgets a tenant after a write; also blocks in-flight reads from re-caching it. */
  invalidate(id: string): void {
    this.currentVersion++;
    this.drop(id);
  }

  /** Removes expired rows so tenants that stop receiving traffic don't accumulate. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.byId) if (now >= entry.expiresAt) this.drop(id);
  }

  private drop(id: string): void {
    const entry = this.byId.get(id);
    if (entry === undefined) return;
    this.byId.delete(id);
    if (this.slugToId.get(entry.tenant.slug) === id) this.slugToId.delete(entry.tenant.slug);
  }
}
