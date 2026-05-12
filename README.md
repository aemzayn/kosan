# Huni

First-class multi-tenancy with database-per-tenant support for Node.js — the layer that Sequelize, Prisma, and TypeORM don't ship.

## Why

Every major Node.js ORM requires you to hand-roll the same things:

- A connection manager that opens one pool per tenant
- A tenant resolver tied to your HTTP framework
- Request-scoped context propagation (no prop-drilling)
- LRU eviction and idle-connection cleanup
- Per-tenant migration orchestration

Huni does all of this for you, with a clean adapter model so you keep using the ORM you already know.

## Packages

| Package | Description |
|---|---|
| [`@huni/core`](./packages/core) | ORM-agnostic registry, cache, context, resolvers |
| [`@huni/sequelize`](./packages/sequelize) | Sequelize v6 adapter |
| [`@huni/express`](./packages/express) | Express middleware |
| [`@huni/fastify`](./packages/fastify) | Fastify plugin |
| [`@huni/cli`](./packages/cli) | Migration orchestrator |

## Quick Start

```bash
npm install @huni/core @huni/sequelize @huni/express
```

### 1 — Connect to the master database

```ts
import { TenantRegistry } from '@huni/core';
import { SequelizeAdapter, SequelizeMasterStore } from '@huni/sequelize';
import { Sequelize } from 'sequelize';

const master = new Sequelize('postgres://admin:pass@localhost/master');

const registry = await TenantRegistry.create({
  master: new SequelizeMasterStore(master),
  adapter: new SequelizeAdapter({
    defaultDialect: 'postgres',
    pool: { max: 5, idle: 30_000 },
  }),
});
```

### 2 — Register a tenant

```ts
const tenant = await registry.createTenant({
  slug: 'acme',
  host: 'localhost',
  port: 5432,
  dbName: 'acme_db',
  user: 'acme_user',
  password: 'acme_pass',
  meta: { plan: 'pro' },
});
```

### 3 — Define models

```ts
// models/order.ts
import type { AdapterContext } from '@huni/sequelize';
import { DataTypes } from 'sequelize';

export function OrderModel({ sequelize }: AdapterContext) {
  return sequelize.define('Order', {
    id:    { type: DataTypes.UUID, primaryKey: true },
    total: { type: DataTypes.DECIMAL },
  });
}

registry.registerModels([OrderModel]);
```

### 4 — Express middleware

```ts
import express from 'express';
import { tenantMiddleware } from '@huni/express';
import { SubdomainResolver } from '@huni/core';

const app = express();

app.use(tenantMiddleware({ registry, resolver: new SubdomainResolver() }));
```

### 5 — Use models in a handler

```ts
import { useTenant } from '@huni/core';

app.get('/orders', async (req, res) => {
  const { models } = useTenant();
  const orders = await models.Order.findAll();
  res.json(orders);
});
```

### 6 — Lifecycle hooks

```ts
TenantRegistry.create({
  master: ...,
  adapter: ...,
  hooks: {
    async onCreate(tenant, conn) {
      await conn.query(`CREATE DATABASE ${tenant.dbName}`);
    },
    async onDelete(tenant) { /* archive or drop */ },
    async onSuspend(tenant) { /* notify */ },
  },
});
```

### 7 — Run migrations across all tenants

```bash
npx huni migrate --config huni.config.ts --concurrency 4
```

### Optional — credential encryption

```ts
TenantRegistry.create({
  master: ...,
  adapter: ...,
  cipher: {
    encrypt: (plain) => kms.encrypt(plain),
    decrypt: (cipher) => kms.decrypt(cipher),
  },
});
```

## Tenant resolvers

| Resolver | Example |
|---|---|
| `SubdomainResolver` | `acme.myapp.com` → `acme` |
| `HeaderResolver('X-Tenant-ID')` | `X-Tenant-ID: acme` header |
| `PathResolver({ segment: 0 })` | `/acme/orders` → `acme` |
| Custom async function | `(req) => req.user?.tenantId` |

## Requirements

- Node.js ≥ 18
- TypeScript ≥ 5 (strict mode)

## Development

```bash
pnpm install
pnpm test        # all packages
pnpm build       # all packages
pnpm lint        # Biome
```

## License

MIT
