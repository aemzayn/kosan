# Kosan [WIP]

[![CI](https://github.com/aemzayn/kosan/actions/workflows/ci.yml/badge.svg)](https://github.com/aemzayn/kosan/actions/workflows/ci.yml)

First-class multi-tenancy with database-per-tenant support for Node.js — the layer that Sequelize, Prisma, and Drizzle don't ship.

**[Documentation](https://aemzayn.github.io/kosan)**

---

## Why

Every major Node.js ORM requires you to hand-roll the same things:

- A connection manager that opens one pool per tenant
- A tenant resolver tied to your HTTP framework
- Request-scoped context propagation (no prop-drilling)
- LRU eviction and idle-connection cleanup
- Per-tenant migration orchestration

Kosan does all of this for you, with a clean adapter model so you keep using the ORM you already know.

---

## Packages

| Package | Description |
|---|---|
| [`@kosan/core`](./packages/core) | ORM-agnostic registry, cache, context, resolvers |
| [`@kosan/sequelize`](./packages/sequelize) | Sequelize v6 adapter |
| [`@kosan/prisma`](./packages/prisma) | Prisma adapter |
| [`@kosan/drizzle`](./packages/drizzle) | Drizzle ORM adapter |
| [`@kosan/express`](./packages/express) | Express middleware |
| [`@kosan/fastify`](./packages/fastify) | Fastify plugin (v4 & v5) |
| [`@kosan/koa`](./packages/koa) | Koa middleware |
| [`@kosan/nestjs`](./packages/nestjs) | NestJS module |
| [`@kosan/cli`](./packages/cli) | Migration orchestrator CLI |

---

## Quick Start

### Sequelize + Express

```bash
npm install @kosan/core @kosan/sequelize @kosan/express
```

```ts
import { TenantRegistry, SubdomainResolver, useTenant } from '@kosan/core';
import { SequelizeAdapter, SequelizeMasterStore } from '@kosan/sequelize';
import { tenantMiddleware } from '@kosan/express';
import { Sequelize, DataTypes } from 'sequelize';
import express from 'express';

// 1 — Connect to the master database
const master = new Sequelize('postgres://admin:pass@localhost/master');
const masterStore = await SequelizeMasterStore.create(master);

const registry = await TenantRegistry.create({
  master: masterStore,
  adapter: new SequelizeAdapter({ defaultDialect: 'postgres' }),
  hooks: {
    async onCreate(tenant, conn) {
      await conn.sync(); // create tables in the new tenant's database
    },
  },
});

// 2 — Register models (factory called once per tenant connection)
registry.registerModels([
  function OrderModel(sequelize: Sequelize) {
    return sequelize.define('Order', {
      id:    { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      total: { type: DataTypes.DECIMAL },
    });
  },
]);

// 3 — Wire up Express middleware
const app = express();
app.use(tenantMiddleware({ registry, resolver: new SubdomainResolver() }));

// 4 — Use models in route handlers — no prop-drilling
app.get('/orders', async (_req, res) => {
  const { models } = useTenant();
  res.json(await (models.Order as any).findAll());
});

app.listen(3000);
```

### Prisma + Koa

```bash
npm install @kosan/core @kosan/prisma @kosan/koa
```

```ts
import { TenantRegistry, SubdomainResolver, useTenant } from '@kosan/core';
import { PrismaAdapter, PrismaMasterStore, usePrisma } from '@kosan/prisma';
import { tenantMiddleware } from '@kosan/koa';
import { PrismaClient } from '@prisma/client';
import Koa from 'koa';

const masterPrisma = new PrismaClient();

const registry = await TenantRegistry.create({
  master: new PrismaMasterStore(masterPrisma.tenant),
  adapter: new PrismaAdapter({
    PrismaClient,
    buildUrl: (t) => `postgresql://${t.user}:${t.password}@${t.host}:${t.port}/${t.dbName}`,
  }),
});

const app = new Koa();
app.use(tenantMiddleware({ registry, resolver: new SubdomainResolver() }));

app.use(async (ctx) => {
  const prisma = usePrisma<PrismaClient>();
  ctx.body = await prisma.order.findMany();
});
```

### Drizzle + Fastify

```bash
npm install @kosan/core @kosan/drizzle @kosan/fastify drizzle-orm postgres
```

```ts
import { TenantRegistry, SubdomainResolver } from '@kosan/core';
import { DrizzleAdapter, DrizzleMasterStore, useDrizzle } from '@kosan/drizzle';
import tenantPlugin from '@kosan/fastify';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import Fastify from 'fastify';
import * as schema from './schema.js';

type TenantDb = ReturnType<typeof drizzle<typeof schema>>;

const registry = await TenantRegistry.create({
  master: new DrizzleMasterStore({ /* query callbacks */ }),
  adapter: new DrizzleAdapter<TenantDb>({
    clientFactory: (t) =>
      drizzle(postgres(`postgres://${t.user}:${t.password}@${t.host}:${t.port}/${t.dbName}`), { schema }),
  }),
});

const fastify = Fastify();
await fastify.register(tenantPlugin, { registry, resolver: new SubdomainResolver() });

fastify.get('/orders', async () => {
  const db = useDrizzle<TenantDb>();
  return db.select().from(schema.orders);
});
```

---

## Tenant resolvers

| Resolver | Extracts tenant from |
|---|---|
| `SubdomainResolver` | `acme.myapp.com` → `acme` |
| `HeaderResolver('X-Tenant-ID')` | `X-Tenant-ID: acme` header |
| `PathResolver({ segment: 0 })` | `/acme/orders` → `acme` |
| Custom function | `(req) => req.user?.tenantId` |

---

## Lifecycle hooks

```ts
TenantRegistry.create({
  // ...
  hooks: {
    async onCreate(tenant, conn) {
      // provision the physical database, run initial migrations, etc.
    },
    async onDelete(tenant) { /* archive or drop */ },
    async onSuspend(tenant) { /* notify downstream services */ },
  },
});
```

---

## Run migrations across all tenants

```bash
npx kosan migrate --config kosan.config.ts --concurrency 4
```

---

## Examples

| Example | Stack |
|---|---|
| [`sequelize-express`](./examples/sequelize-express) | Sequelize + Express |
| [`sequelize-nestjs`](./examples/sequelize-nestjs) | Sequelize + NestJS |
| [`drizzle-fastify`](./examples/drizzle-fastify) | Drizzle + Fastify |
| [`prisma-koa`](./examples/prisma-koa) | Prisma + Koa |

---

## Requirements

- Node.js ≥ 20
- TypeScript ≥ 5 (strict mode recommended)

---

## Development

```bash
pnpm install
pnpm test        # run all tests
pnpm build       # build all packages
pnpm typecheck   # type-check all packages
pnpm lint        # Biome lint
```

**Releasing** — see [RELEASING.md](./RELEASING.md).

---

## License

MIT
