import type { MasterStore, TenantConfig, CreateTenantInput, UpdateTenantInput, TenantStatus } from '@kosan/core';
import type { DrizzleMasterStoreQueries } from './types.js';

export class DrizzleMasterStore implements MasterStore {
  constructor(private readonly queries: DrizzleMasterStoreQueries) {}

  findAll(filter?: { status?: TenantStatus }): Promise<TenantConfig[]> {
    return this.queries.findAll(filter);
  }

  findBySlug(slug: string): Promise<TenantConfig | null> {
    return this.queries.findBySlug(slug);
  }

  findById(id: string): Promise<TenantConfig | null> {
    return this.queries.findById(id);
  }

  create(data: CreateTenantInput): Promise<TenantConfig> {
    return this.queries.create(data);
  }

  update(id: string, data: UpdateTenantInput): Promise<TenantConfig> {
    return this.queries.update(id, data);
  }

  delete(id: string): Promise<void> {
    return this.queries.delete(id);
  }
}
