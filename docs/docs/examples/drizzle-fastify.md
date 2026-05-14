---
---

# Posts App (Drizzle + Fastify)

End-to-end demo: 3 tenants on separate Postgres databases, resolved by subdomain, using Drizzle ORM and Fastify.

**Source:** [`examples/drizzle-fastify/`](https://github.com/kosan-dev/kosan/tree/main/examples/drizzle-fastify)

---

## What it covers

| Feature | Where |
|---|---|
| Subdomain-based tenant resolution | `server.ts` → `SubdomainResolver` |
| Per-tenant Drizzle client | `registry.ts` → `DrizzleAdapter` |
| Drizzle master store (query callbacks) | `registry.ts` → `DrizzleMasterStore` |
| Typed `useDrizzle<TenantDb>()` in handlers | `server.ts` routes |
| `onCreate` hook (table creation) | `registry.ts` hooks |
| Tenant provisioning | `provision.ts` |
| Connection cache stats | `GET /health` |

---

## Running it

```bash
# 1 — start four Postgres containers (master + 3 tenant DBs)
docker-compose up -d

# 2 — install dependencies (from repo root)
pnpm install

# 3 — create the tenants table in the master DB
psql postgres://admin:admin@localhost:5432/master \
  -c "CREATE TABLE tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    host text NOT NULL,
    port integer NOT NULL,
    db_name text NOT NULL,
    \"user\" text NOT NULL,
    password text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    meta jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );"

# 4 — provision the three demo tenants
pnpm provision

# 5 — start the server
pnpm start
```

---

## Try it

The server reads the tenant from the **request subdomain**.

```bash
# Tenant "acme"
curl -H "Host: acme.localhost" http://localhost:3000/
curl -H "Host: acme.localhost" http://localhost:3000/posts

# Create a post for globex
curl -H "Host: globex.localhost" -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","body":"World"}'

# Tenant "acme" — separate database, sees no globex posts
curl -H "Host: acme.localhost" http://localhost:3000/posts

# Health / cache stats
curl http://localhost:3000/health
```

---

## Key integration points

### DrizzleAdapter — clientFactory

Each tenant connection is created by a `clientFactory` you supply. This is where you pick the driver and bind the schema:

```ts
const adapter = new DrizzleAdapter<TenantDb>({
  clientFactory: (tenant) =>
    drizzle(
      postgres(`postgres://${tenant.user}:${tenant.password}@${tenant.host}:${tenant.port}/${tenant.dbName}`),
      { schema: tenantSchema },
    ),
});
```

### DrizzleMasterStore — query callbacks

`DrizzleMasterStore` is dialect-agnostic. You supply the CRUD callbacks using your own Drizzle query builder:

```ts
const masterStore = new DrizzleMasterStore({
  findAll: async (filter) => { /* db.select().from(tenants) */ },
  findBySlug: async (slug) => { /* db.select()...where(eq(tenants.slug, slug)) */ },
  create: async (data) => { /* db.insert(tenants).values(...).returning() */ },
  // ...
});
```

### useDrizzle() in route handlers

```ts
import { useDrizzle } from '@kosan/drizzle';

fastify.get('/posts', async () => {
  const db = useDrizzle<TenantDb>();
  return db.select().from(posts);
});
```

---

## Ports

| Service | Port |
|---|---|
| master DB | 5432 |
| acme DB | 5433 |
| globex DB | 5434 |
| initech DB | 5435 |
| HTTP server | 3000 |
