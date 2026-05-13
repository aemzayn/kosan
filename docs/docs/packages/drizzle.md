---
---

# @huni/drizzle

Drizzle ORM adapter for Huni — creates one typed Drizzle client per tenant and exposes it via the `useDrizzle()` shortcut.

```bash
npm install @huni/drizzle drizzle-orm
```

---

## Design

Drizzle doesn't use a centralized model registry — the client **is** the query interface. `DrizzleAdapter` therefore stores the Drizzle client as the connection and makes it available as `models.drizzle`. `useDrizzle<TClient>()` is a typed shortcut to retrieve it.

---

## Quick start

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DrizzleAdapter, DrizzleMasterStore, useDrizzle } from '@huni/drizzle';
import { TenantRegistry, SubdomainResolver, runWithTenant } from '@huni/core';
import { eq } from 'drizzle-orm';
import * as schema from './schema.js'; // your Drizzle schema
import { tenants } from './schema.js'; // the tenants table

// 1 — Master DB client (one shared client for tenant metadata)
const masterClient = postgres(process.env.MASTER_DATABASE_URL!);
const masterDb = drizzle(masterClient, { schema });

// 2 — MasterStore backed by your Drizzle schema
const masterStore = new DrizzleMasterStore({
  findAll: (filter) =>
    filter?.status
      ? masterDb.select().from(tenants).where(eq(tenants.status, filter.status))
      : masterDb.select().from(tenants),

  findBySlug: async (slug) => {
    const rows = await masterDb.select().from(tenants).where(eq(tenants.slug, slug));
    return rows[0] ?? null;
  },

  findById: async (id) => {
    const rows = await masterDb.select().from(tenants).where(eq(tenants.id, id));
    return rows[0] ?? null;
  },

  create: async (data) => {
    const [row] = await masterDb.insert(tenants).values(data).returning();
    return row;
  },

  update: async (id, data) => {
    const [row] = await masterDb.update(tenants).set(data).where(eq(tenants.id, id)).returning();
    return row;
  },

  delete: (id) => masterDb.delete(tenants).where(eq(tenants.id, id)).then(() => {}),
});

// 3 — Tenant adapter: one Drizzle client per tenant
type TenantDb = ReturnType<typeof drizzle<typeof schema>>;

const adapter = new DrizzleAdapter<TenantDb>({
  clientFactory: (tenant) =>
    drizzle(
      postgres(
        `postgres://${tenant.user}:${tenant.password}@${tenant.host}:${tenant.port}/${tenant.dbName}`,
      ),
      { schema },
    ),
});

// 4 — Registry
const registry = await TenantRegistry.create({ master: masterStore, adapter });

// 5 — Access inside a request handler
app.get('/orders', async (req, res) => {
  const ctx = await registry.resolveBySlug('acme');
  await runWithTenant(ctx, async () => {
    const db = useDrizzle<TenantDb>();
    const orders = await db.select().from(schema.orders);
    res.json(orders);
  });
});
```

---

## `DrizzleAdapter`

```ts
new DrizzleAdapter({ clientFactory })
```

| Option | Type | Description |
|---|---|---|
| `clientFactory` | `(tenant: TenantConfig) => TClient \| Promise<TClient>` | Creates a Drizzle client for the given tenant |

`DrizzleAdapter` implements the `Adapter<TClient>` interface:

- **`connect(tenant)`** — calls `clientFactory(tenant)`.
- **`disconnect(client)`** — calls `$client.end()` / `$client.close()` / `$client.destroy()` in that order, or no-ops if `$client` is absent.
- **`getModels(client)`** — returns `{ drizzle: client }`.

---

## `DrizzleMasterStore`

```ts
new DrizzleMasterStore(queries)
```

A thin wrapper around user-supplied query callbacks that implements `MasterStore`. You supply one function per operation — use whatever Drizzle client and table you have for the master database.

```ts
export interface DrizzleMasterStoreQueries {
  findAll(filter?: { status?: TenantStatus }): Promise<TenantConfig[]>;
  findBySlug(slug: string): Promise<TenantConfig | null>;
  findById(id: string): Promise<TenantConfig | null>;
  create(data: CreateTenantInput): Promise<TenantConfig>;
  update(id: string, data: UpdateTenantInput): Promise<TenantConfig>;
  delete(id: string): Promise<void>;
}
```

---

## `useDrizzle<TClient>()`

Typed shortcut that returns the current tenant's Drizzle client.

```ts
import { useDrizzle } from '@huni/drizzle';
import type { TenantDb } from './db.js';

const db = useDrizzle<TenantDb>();
const orders = await db.select().from(ordersTable);
```

Must be called inside a `runWithTenant()` or `TenantMiddleware` context. Throws if called outside.

---

## Tenant table schema

Copy one of these snippets into your Drizzle schema file:

### PostgreSQL

```ts
import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id:        text('id').primaryKey(),
  slug:      text('slug').notNull().unique(),
  host:      text('host').notNull(),
  port:      integer('port').notNull(),
  dbName:    text('db_name').notNull(),
  user:      text('user').notNull(),
  password:  text('password').notNull(),
  status:    text('status', { enum: ['active', 'suspended', 'deleted'] })
               .notNull().default('active'),
  meta:      jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

Or import the snippet from the library:

```ts
import { TENANT_DRIZZLE_SCHEMA_PG } from '@huni/drizzle';
console.log(TENANT_DRIZZLE_SCHEMA_PG); // copy-paste ready
```

Available exports: `TENANT_DRIZZLE_SCHEMA_PG`, `TENANT_DRIZZLE_SCHEMA_SQLITE`, `TENANT_DRIZZLE_SCHEMA_MYSQL`.

---

## Disconnecting clients

`DrizzleAdapter.disconnect()` checks `client.$client` for a known teardown method. If your client doesn't expose `$client` (e.g., a custom wrapper), override it or handle cleanup in your application's shutdown hook:

```ts
await registry.shutdown(); // evicts all cached connections, calls disconnect on each
```

---

## Compatibility

Works with `drizzle-orm` ≥ 0.30.0 and any Drizzle dialect (postgres-js, node-postgres, better-sqlite3, mysql2, libSQL).
