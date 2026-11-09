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
 */
export class TenantLookupCache {
  private readonly byId = new Map<string, Entry>();
  private readonly slugToId = new Map<string, string>();

  constructor(private readonly ttlMs: number) {}

  getBySlug(slug: string): TenantConfig | undefined {
    const id = this.slugToId.get(slug);
    return id === undefined ? undefined : this.getById(id);
  }

  getById(id: string): TenantConfig | undefined {
    const entry = this.byId.get(id);
    if (entry === undefined) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.invalidate(id);
      return undefined;
    }
    return entry.tenant;
  }

  set(tenant: TenantConfig): void {
    if (this.ttlMs <= 0) return;
    this.invalidate(tenant.id); // drops a stale slug mapping if the slug changed
    this.byId.set(tenant.id, { tenant, expiresAt: Date.now() + this.ttlMs });
    this.slugToId.set(tenant.slug, tenant.id);
  }

  invalidate(id: string): void {
    const entry = this.byId.get(id);
    if (entry === undefined) return;
    this.byId.delete(id);
    if (this.slugToId.get(entry.tenant.slug) === id) this.slugToId.delete(entry.tenant.slug);
  }
}
