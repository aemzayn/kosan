# sequelize-nestjs example

End-to-end demo: 3 tenants on separate Postgres databases, resolved by subdomain, served by NestJS.

## Prerequisites

- Docker & Docker Compose
- Node.js ≥ 18
- pnpm

## Run

```bash
# 1 — start four Postgres containers (master + 3 tenant DBs)
docker-compose up -d

# 2 — install dependencies (from repo root)
pnpm install

# 3 — create the three tenant rows and sync their schemas
pnpm --filter sequelize-nestjs-example provision

# 4 — start the server
pnpm --filter sequelize-nestjs-example start
```

## Try it

The server reads the tenant from the request subdomain.

```bash
# Tenant "acme"
curl -H "Host: acme.localhost" http://localhost:3000/orders
curl -H "Host: acme.localhost" -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"product":"Widget","quantity":2,"total":"19.99"}'

# Tenant "globex" — completely separate database
curl -H "Host: globex.localhost" http://localhost:3000/orders

# Admin: list all tenants (no subdomain needed)
curl http://localhost:3000/tenants

# Health / cache stats (no subdomain needed)
curl http://localhost:3000/health
```

## What it demonstrates

| Feature | Where |
|---|---|
| `HuniModule.forRoot` | `src/app.module.ts` |
| Subdomain resolution | `AppModule` → `SubdomainResolver` |
| `TenantMiddleware` applied globally | `AppModule.configure()` |
| `@CurrentTenant()` decorator | `src/orders/orders.controller.ts` |
| `@InjectRegistry()` decorator | `src/health/health.controller.ts`, `src/tenants/tenants.controller.ts` |
| Per-tenant Sequelize instance | `src/registry.ts` → `SequelizeAdapter` |
| `onCreate` hook (schema sync) | `src/registry.ts` hooks |
| Tenant provisioning | `src/provision.ts` |
| Excluding admin routes from middleware | `AppModule.configure()` → `.exclude()` |

## Ports

| Service | Port |
|---|---|
| master DB | 5432 |
| acme DB | 5433 |
| globex DB | 5434 |
| initech DB | 5435 |
| HTTP server | 3000 |
