---
sidebar_position: 1
---

# Orders App (Sequelize + Express)

End-to-end demo: 3 tenants on separate Postgres databases, resolved by subdomain.

**Source:** [`examples/sequelize-express/`](https://github.com/huni-dev/huni/tree/main/examples/sequelize-express)

---

## What it covers

| Feature | Where |
|---|---|
| Subdomain-based tenant resolution | `server.ts` → `SubdomainResolver` |
| Per-tenant Sequelize instance | `registry.ts` → `SequelizeAdapter` |
| Model registration | `registry.registerModels([OrderModel])` |
| `useTenant()` in handlers | `server.ts` routes |
| `onCreate` hook (schema sync) | `registry.ts` hooks |
| Tenant provisioning | `provision.ts` |
| Connection cache stats | `GET /health` |

---

## Running it

```bash
# 1 — start four Postgres containers (master + 3 tenant DBs)
docker-compose up -d

# 2 — install dependencies (from repo root)
pnpm install

# 3 — create tenant rows and sync schemas
pnpm provision

# 4 — start the server
pnpm start
```

---

## Try it

The server reads the tenant from the **request subdomain**.

```bash
# Tenant "acme"
curl -H "Host: acme.localhost" http://localhost:3000/
curl -H "Host: acme.localhost" http://localhost:3000/orders

# Create an order
curl -H "Host: acme.localhost" -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"product":"Widget","quantity":2,"total":"19.99"}'

# Tenant "globex" — completely separate database
curl -H "Host: globex.localhost" http://localhost:3000/orders

# Health / cache stats
curl http://localhost:3000/health
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
