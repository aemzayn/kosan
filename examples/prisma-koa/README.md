# prisma-koa

Kosan example using **Prisma** + **Koa** with subdomain-based multi-tenancy.

Each tenant (`acme`, `globex`, `initech`) gets its own Postgres database. The
master database holds the tenant registry managed by Prisma. Each tenant
connection is also a PrismaClient pointed at its own database.

## Stack

- [`@kosan/prisma`](https://aemzayn.github.io/kosan) — tenant adapter + master store
- [`@kosan/koa`](https://aemzayn.github.io/kosan) — request-level tenant resolution
- [Prisma](https://prisma.io) v5
- [Koa](https://koajs.com) v2

## Quick start

```bash
# 1. Start all four Postgres instances
docker-compose up -d

# 2. Install dependencies
pnpm install

# 3. Set the master database URL and push the schema
DATABASE_URL="postgresql://admin:admin@localhost:5432/master" pnpm db:push

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
prisma/
  schema.prisma        Master database schema (Tenant model for PrismaMasterStore)
  tenant-schema.prisma Tenant database schema reference (Post model)
src/
  registry.ts          Sets up PrismaAdapter + PrismaMasterStore + TenantRegistry
  server.ts            Koa app with tenant middleware and route handlers
  provision.ts         One-shot script to seed the three demo tenants
```
