import type { TenantConfig, CreateTenantInput, UpdateTenantInput, TenantStatus } from '@kosan/core';

/**
 * A Drizzle client instance. We use structural typing so the adapter works
 * with any Drizzle dialect (postgres-js, node-postgres, better-sqlite3, mysql2)
 * without importing a specific driver package.
 */
export interface DrizzleClientLike {
  /** Called at disconnect; may not exist on all dialect clients. */
  $client?: {
    end?: () => Promise<void>;
    close?: () => Promise<void>;
    destroy?: () => void;
  };
}

/**
 * Factory that creates a Drizzle client from a TenantConfig.
 * The user owns driver selection and schema binding — this is the only
 * integration point for the per-tenant connection.
 *
 * @example
 * ```ts
 * import { drizzle } from 'drizzle-orm/postgres-js';
 * import postgres from 'postgres';
 *
 * const clientFactory: DrizzleClientFactory = (tenant) =>
 *   drizzle(postgres(`postgres://${tenant.user}:${tenant.password}@${tenant.host}:${tenant.port}/${tenant.dbName}`));
 * ```
 */
export type DrizzleClientFactory<TClient extends DrizzleClientLike = DrizzleClientLike> = (
  tenant: TenantConfig,
) => TClient | Promise<TClient>;

export interface DrizzleAdapterOptions<TClient extends DrizzleClientLike = DrizzleClientLike> {
  clientFactory: DrizzleClientFactory<TClient>;
}

export interface DrizzleModels<TClient extends DrizzleClientLike = DrizzleClientLike> {
  /** The raw Drizzle client, typed exactly as returned by `clientFactory`. */
  drizzle: TClient;
}

// ---------------------------------------------------------------------------
// DrizzleMasterStore query callbacks
// ---------------------------------------------------------------------------

/**
 * User-supplied CRUD callbacks backed by a Drizzle query builder.
 * This approach avoids importing dialect-specific Drizzle types in the library
 * while remaining fully type-safe on the user side.
 *
 * @example
 * ```ts
 * import { eq } from 'drizzle-orm';
 * import { tenants } from './schema';
 *
 * const masterStore = new DrizzleMasterStore({
 *   findAll: (filter) =>
 *     filter?.status
 *       ? db.select().from(tenants).where(eq(tenants.status, filter.status))
 *       : db.select().from(tenants),
 *   findBySlug: (slug) =>
 *     db.select().from(tenants).where(eq(tenants.slug, slug))
 *       .then((rows) => rows[0] ?? null),
 *   findById: (id) =>
 *     db.select().from(tenants).where(eq(tenants.id, id))
 *       .then((rows) => rows[0] ?? null),
 *   create: (data) =>
 *     db.insert(tenants).values(data).returning().then(([r]) => r),
 *   update: (id, data) =>
 *     db.update(tenants).set(data).where(eq(tenants.id, id))
 *       .returning().then(([r]) => r),
 *   delete: (id) =>
 *     db.delete(tenants).where(eq(tenants.id, id)),
 * });
 * ```
 */
export interface DrizzleMasterStoreQueries {
  findAll(filter?: { status?: TenantStatus }): Promise<TenantConfig[]>;
  findBySlug(slug: string): Promise<TenantConfig | null>;
  findById(id: string): Promise<TenantConfig | null>;
  create(data: CreateTenantInput): Promise<TenantConfig>;
  update(id: string, data: UpdateTenantInput): Promise<TenantConfig>;
  delete(id: string): Promise<void>;
}
