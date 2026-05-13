---
---

# @huni/sequelize

Sequelize v6 adapter for Huni. Provides `SequelizeAdapter` (one Sequelize instance per tenant) and `SequelizeMasterStore` (the `tenants` table backed by Sequelize).

```bash
npm install @huni/sequelize sequelize
```

---

## SequelizeMasterStore

Implements `MasterStore` using Sequelize. Stores tenant records in a `tenants` table and creates it automatically on first use.

```ts
import { Sequelize } from 'sequelize';
import { SequelizeMasterStore } from '@huni/sequelize';

const master = new Sequelize('postgres://admin:pass@localhost/master', {
  logging: false,
});

// Syncs the table schema (creates if missing, safe to call on every startup).
const masterStore = await SequelizeMasterStore.create(master);

// You can also pass sync options:
const masterStore = await SequelizeMasterStore.create(master, {
  alter: true, // use { alter: true } in development; run explicit migrations in production
});
```

The `tenants` table schema:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key, auto-generated |
| `slug` | STRING | Unique, used for resolution |
| `host` | STRING | DB host |
| `port` | INTEGER | DB port |
| `dbName` | STRING | Database name |
| `user` | STRING | DB username |
| `password` | STRING | Stored encrypted if `cipher` is set |
| `status` | ENUM | `active` / `suspended` / `deleted` |
| `meta` | JSON | Arbitrary metadata |
| `createdAt` | DATE | Auto-managed |
| `updatedAt` | DATE | Auto-managed |

---

## SequelizeAdapter

Implements `Adapter<Sequelize>`. Creates one Sequelize instance per tenant, applies model factories, and handles graceful shutdown.

```ts
import { SequelizeAdapter } from '@huni/sequelize';

const adapter = new SequelizeAdapter({
  defaultDialect: 'postgres', // fallback if tenant.meta.dialect is not set
  pool: {
    max: 5,        // default
    min: 0,        // default
    acquire: 30_000, // ms to wait for a connection before throwing
    idle: 10_000,  // ms before an idle connection is released to the pool
  },
  dialectOptions: {
    // Passed verbatim to the Sequelize constructor
    ssl: { require: true, rejectUnauthorized: false },
  },
  logging: false,  // or: (sql, timing) => logger.debug({ sql, timing })
});
```

### Options

```ts
interface SequelizeAdapterOptions {
  defaultDialect?: 'postgres' | 'mysql' | 'mariadb' | 'sqlite' | 'mssql';
  pool?: {
    max?: number;
    min?: number;
    acquire?: number;
    idle?: number;
  };
  dialectOptions?: Record<string, unknown>;
  logging?: boolean | ((sql: string, timing?: number) => void);

  // Slow-query detection (Milestone 5)
  onSlowQuery?: (info: SlowQueryInfo) => void;
  slowQueryThresholdMs?: number; // default: 1000
}
```

---

## Model factories

Model factories are functions that receive an `AdapterContext` and register models on the Sequelize instance. They run once per new tenant connection.

```ts
import { DataTypes } from 'sequelize';
import type { AdapterContext } from '@huni/sequelize';

export function OrderModel({ sequelize }: AdapterContext) {
  return sequelize.define('Order', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    description: { type: DataTypes.STRING(500), allowNull: false },
    total:       { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    status:      {
      type: DataTypes.ENUM('pending', 'paid', 'cancelled'),
      defaultValue: 'pending',
    },
  }, {
    tableName: 'orders',
  });
}

export function UserModel({ sequelize }: AdapterContext) {
  return sequelize.define('User', {
    id:    { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    name:  { type: DataTypes.STRING, allowNull: false },
  });
}
```

Register them before the first request:

```ts
registry.registerModels([OrderModel, UserModel]);
```

Access them in handlers:

```ts
import { useTenant } from '@huni/core';
import type { ModelStatic, Model } from 'sequelize';

const { models } = useTenant();
const Order = models['Order'] as ModelStatic<Model>;
const order = await Order.findByPk(id);
```

---

## Slow-query detection

When `onSlowQuery` is configured, the adapter wraps Sequelize's `logging` option with `benchmark: true` and fires the callback for any query that exceeds the threshold.

```ts
import { SequelizeAdapter } from '@huni/sequelize';
import type { SlowQueryInfo } from '@huni/sequelize';
import pino from 'pino';

const logger = pino();

const adapter = new SequelizeAdapter({
  onSlowQuery: (info: SlowQueryInfo) => {
    logger.warn({
      sql: info.sql,
      durationMs: info.durationMs,
      tenantId: info.tenantId,
      tenantSlug: info.tenantSlug,
    }, 'slow query detected');
  },
  slowQueryThresholdMs: 500, // default 1000 ms
});
```

`SlowQueryInfo`:

```ts
interface SlowQueryInfo {
  sql: string;
  durationMs: number;
  tenantId: string;
  tenantSlug: string;
}
```

You can combine `onSlowQuery` with the `logging` option — both fire independently:

```ts
const adapter = new SequelizeAdapter({
  logging: (sql) => logger.debug(sql),
  onSlowQuery: (info) => logger.warn(info, 'slow query'),
  slowQueryThresholdMs: 300,
});
```

---

## Per-tenant dialect override

If tenants use different database engines, store the dialect in `meta`:

```ts
await registry.createTenant({
  slug: 'acme',
  host: 'mysql.acme.com',
  port: 3306,
  dbName: 'acme',
  user: 'app',
  password: 'secret',
  meta: { dialect: 'mysql' },  // overrides adapter.defaultDialect
});
```

---

## Running with SQLite in tests

```ts
import { Sequelize } from 'sequelize';
import { SequelizeAdapter, SequelizeMasterStore } from '@huni/sequelize';
import { TenantRegistry } from '@huni/core';

const master = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
const masterStore = await SequelizeMasterStore.create(master);

const adapter = new SequelizeAdapter({ defaultDialect: 'sqlite', logging: false });

const registry = await TenantRegistry.create({ master: masterStore, adapter });

await registry.createTenant({
  slug: 'test',
  host: '',
  port: 0,
  dbName: ':memory:',
  user: '',
  password: '',
  meta: { dialect: 'sqlite' },
});
```
