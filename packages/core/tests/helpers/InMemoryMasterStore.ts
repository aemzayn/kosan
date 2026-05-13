import { randomUUID } from "node:crypto";
import type {
  CreateTenantInput,
  MasterStore,
  TenantConfig,
  TenantStatus,
  UpdateTenantInput,
} from "../../src/types.js";

export class InMemoryMasterStore implements MasterStore {
  private rows = new Map<string, TenantConfig>();

  async findAll(filter?: { status?: TenantStatus }): Promise<TenantConfig[]> {
    const all = [...this.rows.values()];
    if (filter?.status !== undefined) return all.filter((t) => t.status === filter.status);
    return all;
  }

  async findBySlug(slug: string): Promise<TenantConfig | null> {
    return [...this.rows.values()].find((t) => t.slug === slug) ?? null;
  }

  async findById(id: string): Promise<TenantConfig | null> {
    return this.rows.get(id) ?? null;
  }

  async create(data: CreateTenantInput): Promise<TenantConfig> {
    const tenant: TenantConfig = {
      id: randomUUID(),
      slug: data.slug,
      host: data.host,
      port: data.port,
      dbName: data.dbName,
      user: data.user,
      password: data.password,
      status: data.status ?? "active",
      meta: data.meta,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(tenant.id, tenant);
    return tenant;
  }

  async update(id: string, data: UpdateTenantInput): Promise<TenantConfig> {
    const existing = this.rows.get(id);
    if (existing === undefined) throw new Error(`Tenant ${id} not found`);
    const updated: TenantConfig = { ...existing, ...data, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  /** Test helper — wipe all rows. */
  clear(): void {
    this.rows.clear();
  }

  get count(): number {
    return this.rows.size;
  }
}
