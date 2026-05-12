---
sidebar_position: 2
---

# Quick Start

This guide walks through a complete Sequelize + Express setup in five minutes. By the end you will have:

- A master database that stores tenant records
- Per-tenant Postgres connections managed automatically
- Express middleware that resolves the tenant from the subdomain
- A route handler that reads from the correct tenant database without any extra configuration

## 1 — Master database connection

```ts title="src/registry.ts"
import { TenantRegistry } from '@huni/core';
import { SequelizeAdapter, SequelizeMasterStore } from '@huni/sequelize';
import { Sequelize } from 'sequelize';

const master = new Sequelize(
  process.env.MASTER_DATABASE_URL ?? 'postgres://admin:pass@localhost/master',
  { logging: false },
);

// Creates the `tenants` table on first run (safe to call every startup).
const masterStore = await SequelizeMasterStore.create(master);

export const registry = await TenantRegistry.create({
  master: masterStore,
  adapter: new SequelizeAdapter({
    defaultDialect: 'postgres',
    pool: { max: 5, idle: 30_000 },
  }),
  cache: {
    maxSize: 100,        // keep at most 100 open connections
    idleTimeoutMs: 1800_000, // evict after 30 min of inactivity
  },
});
```

## 2 — Register a tenant

You only do this once per tenant (e.g. during onboarding):

```ts title="src/onboarding.ts"
import { registry } from './registry.js';

const tenant = await registry.createTenant({
  slug: 'acme',          // used for subdomain resolution
  host: 'localhost',
  port: 5432,
  dbName: 'acme_db',
  user: 'acme_user',
  password: 'acme_pass',
  meta: { plan: 'pro' }, // any JSON you like
});

console.log(tenant.id); // UUID assigned by Huni
```

## 3 — Define models

Model factories are registered once on the registry and called per-connection:

```ts title="src/models/order.ts"
import { DataTypes } from 'sequelize';
import type { AdapterContext } from '@huni/sequelize';

export function OrderModel({ sequelize }: AdapterContext) {
  return sequelize.define('Order', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    description: { type: DataTypes.STRING, allowNull: false },
    total:       { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    status:      { type: DataTypes.ENUM('pending', 'paid', 'cancelled'), defaultValue: 'pending' },
  });
}
```

```ts title="src/registry.ts"
import { OrderModel } from './models/order.js';

registry.registerModels([OrderModel]);
```

## 4 — Express middleware

```ts title="src/app.ts"
import express from 'express';
import { tenantMiddleware } from '@huni/express';
import { SubdomainResolver } from '@huni/core';
import { registry } from './registry.js';

export const app = express();
app.use(express.json());

// Resolve tenant from subdomain: acme.myapp.com → slug "acme"
app.use(
  tenantMiddleware({
    registry,
    resolver: new SubdomainResolver(),
    onMissingTenant: (_req, res) => {
      res.status(400).json({ error: 'No tenant identifier in request.' });
    },
  }),
);
```

## 5 — Use models in a route handler

```ts title="src/routes/orders.ts"
import { useTenant } from '@huni/core';
import type { ModelStatic, Model } from 'sequelize';
import { app } from '../app.js';

app.get('/orders', async (_req, res) => {
  const { models } = useTenant();
  const Order = models['Order'] as ModelStatic<Model>;
  const orders = await Order.findAll({ order: [['createdAt', 'DESC']] });
  res.json(orders);
});

app.post('/orders', async (req, res) => {
  const { models } = useTenant();
  const Order = models['Order'] as ModelStatic<Model>;
  const order = await Order.create(req.body);
  res.status(201).json(order);
});
```

## 6 — Provision a new tenant database on creation

Use the `onCreate` lifecycle hook to run database creation and initial migrations automatically:

```ts title="src/registry.ts"
import { registry } from './registry.js';

const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  hooks: {
    async onCreate(tenant, conn) {
      // conn is a fresh Sequelize instance connected to the new tenant DB.
      await conn.sync({ force: false }); // or run your migration tool here
    },
  },
});
```

## 7 — Start the server

```ts title="src/index.ts"
import { app } from './app.js';

app.listen(3000, () => {
  console.log('Listening on :3000');
});
```

## What happens on a request

1. `tenantMiddleware` calls `SubdomainResolver.resolve(req)` → returns `"acme"`
2. `registry.resolveBySlug("acme")` looks up the tenant row in the master DB
3. `ConnectionCache` opens a new Sequelize connection (or returns the cached one)
4. The context `{ tenant, connection, models }` is stored in `AsyncLocalStorage`
5. `next()` is called — your handler runs inside that context
6. `useTenant()` reads the context and returns the right models, zero prop-drilling

## Next steps

- [Tenant resolvers](../guides/tenant-resolvers) — header, path, JWT, custom
- [Lifecycle hooks](../guides/lifecycle-hooks) — provision, teardown, suspend
- [Credential encryption](../guides/credential-encryption) — store passwords with KMS
- [CLI migrations](../packages/cli) — run schema changes across all tenants
