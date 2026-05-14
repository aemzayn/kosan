import { type TenantConfig, TenantRegistry } from "@kosan/core";
import { DrizzleAdapter, DrizzleMasterStore } from "@kosan/drizzle";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { tenants } from "./master-schema.js";
import * as tenantSchema from "./tenant-schema.js";

// ---------------------------------------------------------------------------
// Master database — holds the tenant registry
// ---------------------------------------------------------------------------

const masterConn = postgres("postgres://admin:admin@localhost:5432/master");
const masterDb = drizzle(masterConn);

function rowToConfig(row: typeof tenants.$inferSelect): TenantConfig {
  return {
    id: row.id,
    slug: row.slug,
    host: row.host,
    port: row.port,
    dbName: row.dbName,
    user: row.user,
    password: row.password,
    status: row.status,
    ...(row.meta != null ? { meta: row.meta } : {}),
    ...(row.createdAt != null ? { createdAt: row.createdAt } : {}),
    ...(row.updatedAt != null ? { updatedAt: row.updatedAt } : {}),
  };
}

const masterStore = new DrizzleMasterStore({
  findAll: async (filter) => {
    const rows = filter?.status
      ? await masterDb.select().from(tenants).where(eq(tenants.status, filter.status))
      : await masterDb.select().from(tenants);
    return rows.map(rowToConfig);
  },
  findBySlug: async (slug) => {
    const rows = await masterDb.select().from(tenants).where(eq(tenants.slug, slug));
    return rows[0] ? rowToConfig(rows[0]) : null;
  },
  findById: async (id) => {
    const rows = await masterDb.select().from(tenants).where(eq(tenants.id, id));
    return rows[0] ? rowToConfig(rows[0]) : null;
  },
  create: async (data) => {
    const [row] = await masterDb
      .insert(tenants)
      .values({
        slug: data.slug,
        host: data.host,
        port: data.port,
        dbName: data.dbName,
        user: data.user,
        password: data.password,
        status: data.status ?? "active",
        meta: data.meta,
      })
      .returning();
    if (!row) throw new Error("Insert failed");
    return rowToConfig(row);
  },
  update: async (id, data) => {
    const [row] = await masterDb
      .update(tenants)
      .set({
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.host !== undefined && { host: data.host }),
        ...(data.port !== undefined && { port: data.port }),
        ...(data.dbName !== undefined && { dbName: data.dbName }),
        ...(data.user !== undefined && { user: data.user }),
        ...(data.password !== undefined && { password: data.password }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.meta !== undefined && { meta: data.meta }),
      })
      .where(eq(tenants.id, id))
      .returning();
    if (!row) throw new Error(`Tenant ${id} not found`);
    return rowToConfig(row);
  },
  delete: async (id) => {
    await masterDb.delete(tenants).where(eq(tenants.id, id));
  },
});

// ---------------------------------------------------------------------------
// Tenant adapter — one Drizzle client per tenant connection
// ---------------------------------------------------------------------------

export type TenantDb = ReturnType<typeof drizzle<typeof tenantSchema>>;

const adapter = new DrizzleAdapter<TenantDb>({
  clientFactory: (tenant) =>
    drizzle(
      postgres(
        `postgres://${tenant.user}:${tenant.password}@${tenant.host}:${tenant.port}/${tenant.dbName}`,
      ),
      { schema: tenantSchema },
    ),
});

export const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  hooks: {
    async onCreate(_tenant, db) {
      await db.execute(
        "CREATE TABLE IF NOT EXISTS posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, body text NOT NULL)",
      );
    },
  },
});
