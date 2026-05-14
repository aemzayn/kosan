---
---

# Posts App (Prisma + Koa)

End-to-end demo: 3 tenants on separate Postgres databases, resolved by subdomain, using Prisma and Koa.

**Source:** [`examples/prisma-koa/`](https://github.com/kosan-dev/kosan/tree/main/examples/prisma-koa)

---

## What it covers

| Feature | Where |
|---|---|
| Subdomain-based tenant resolution | `server.ts` → `SubdomainResolver` |
| Per-tenant PrismaClient | `registry.ts` → `PrismaAdapter` |
| Prisma master store | `registry.ts` → `PrismaMasterStore` |
| `usePrisma<PrismaClient>()` in handlers | `server.ts` routes |
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

# 3 — generate the Prisma client and push the master schema
DATABASE_URL="postgresql://admin:admin@localhost:5432/master" pnpm db:push

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

### PrismaAdapter — buildUrl

`PrismaAdapter` creates one `PrismaClient` instance per tenant, overriding the datasource URL:

```ts
const adapter = new PrismaAdapter({
  PrismaClient,
  buildUrl: (t) =>
    `postgresql://${t.user}:${t.password}@${t.host}:${t.port}/${t.dbName}`,
});
```

### PrismaMasterStore

Pass `prisma.tenant` (the Prisma delegate for your `Tenant` model) directly:

```ts
const masterPrisma = new PrismaClient();
const masterStore = new PrismaMasterStore(masterPrisma.tenant);
```

The required Prisma schema for the `Tenant` model ships as `TENANT_PRISMA_SCHEMA` from `@kosan/prisma`.

### usePrisma() in route handlers

```ts
import { usePrisma } from '@kosan/prisma';

router.get('/posts', async (ctx) => {
  const prisma = usePrisma<PrismaClient>();
  ctx.body = await prisma.$queryRaw`SELECT * FROM posts`;
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
