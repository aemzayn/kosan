# drizzle-fastify

Kosan example using **Drizzle ORM** + **Fastify** with subdomain-based multi-tenancy.

Each tenant (`acme`, `globex`, `initech`) gets its own Postgres database. The
master database holds the tenant registry. Drizzle manages both connections.

## Stack

- [`@kosan/drizzle`](https://aemzayn.github.io/kosan) — tenant adapter + master store
- [`@kosan/fastify`](https://aemzayn.github.io/kosan) — request-level tenant resolution
- [Drizzle ORM](https://orm.drizzle.team) with `postgres-js` driver
- [Fastify](https://fastify.dev) v5

## Quick start

```bash
# 1. Start all four Postgres instances
docker-compose up -d

# 2. Install dependencies
pnpm install

# 3. Create the tenants table in the master DB (run once)
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

# 4. Provision the three demo tenants
pnpm provision

# 5. Start the server
pnpm dev
```

## Try it

```bash
# Hello from acme tenant
curl -H "Host: acme.localhost" http://localhost:3000/

# Create a post for globex
curl -X POST -H "Host: globex.localhost" -H "Content-Type: application/json" \
  -d '{"title":"Hello","body":"World"}' http://localhost:3000/posts

# List posts for acme (separate database — acme sees nothing)
curl -H "Host: acme.localhost" http://localhost:3000/posts

# Health check
curl http://localhost:3000/health
```

## Project structure

```
src/
  master-schema.ts   Drizzle schema for the tenants table (master DB)
  tenant-schema.ts   Drizzle schema applied to every tenant database
  registry.ts        Sets up DrizzleAdapter + DrizzleMasterStore + TenantRegistry
  server.ts          Fastify app with tenant plugin and route handlers
  provision.ts       One-shot script to seed the three demo tenants
```
