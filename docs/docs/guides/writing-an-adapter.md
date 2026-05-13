---
---

# Writing an Adapter

An `Adapter<TConn>` is the bridge between Kosan's connection cache and your ORM or database driver. If you use an ORM that Kosan doesn't ship an adapter for, you can write one in a few dozen lines.

---

## The Adapter interface

```ts
interface Adapter<TConn = unknown> {
  connect(tenant: TenantConfig): Promise<TConn>;
  disconnect(conn: TConn): Promise<void>;
  getModels(conn: TConn): Record<string, unknown>;
  registerModelFactories?(factories: ModelFactory<TConn>[]): void;
}
```

| Method | Required | Description |
|---|---|---|
| `connect` | Yes | Opens a connection for the given tenant. Called once per tenant, result is cached. |
| `disconnect` | Yes | Closes the connection. Called on LRU eviction, idle timeout, and shutdown. |
| `getModels` | Yes | Returns the models registered on this connection. |
| `registerModelFactories` | No | Accepts model factory functions. Omit if your ORM doesn't use factories. |

---

## Minimal example: TypeORM

```ts
import type { Adapter, ModelFactory, TenantConfig } from '@kosan/core';
import { DataSource } from 'typeorm';

export class TypeOrmAdapter implements Adapter<DataSource> {
  private readonly entities: Function[];

  constructor(entities: Function[]) {
    this.entities = entities;
  }

  async connect(tenant: TenantConfig): Promise<DataSource> {
    const ds = new DataSource({
      type: 'postgres',
      host: tenant.host,
      port: tenant.port,
      database: tenant.dbName,
      username: tenant.user,
      password: tenant.password,
      entities: this.entities,
      synchronize: false,
    });
    await ds.initialize();
    return ds;
  }

  async disconnect(ds: DataSource): Promise<void> {
    if (ds.isInitialized) await ds.destroy();
  }

  getModels(ds: DataSource): Record<string, unknown> {
    // Expose TypeORM repositories keyed by entity name
    return Object.fromEntries(
      this.entities.map((entity) => [
        (entity as { name: string }).name,
        ds.getRepository(entity),
      ]),
    );
  }
}
```

Usage:

```ts
import { User } from './entities/user.js';
import { Order } from './entities/order.js';

const adapter = new TypeOrmAdapter([User, Order]);

const registry = await TenantRegistry.create({ master: masterStore, adapter });

// In a handler:
const { models } = useTenant<DataSource>();
const userRepo = models['User'] as Repository<User>;
const users = await userRepo.find();
```

---

## Example: node-postgres (pg)

For cases where you want raw SQL access without an ORM:

```ts
import type { Adapter, TenantConfig } from '@kosan/core';
import { Pool } from 'pg';

export class PgAdapter implements Adapter<Pool> {
  async connect(tenant: TenantConfig): Promise<Pool> {
    const pool = new Pool({
      host: tenant.host,
      port: tenant.port,
      database: tenant.dbName,
      user: tenant.user,
      password: tenant.password,
      max: 5,
    });
    // Verify the connection
    const client = await pool.connect();
    client.release();
    return pool;
  }

  async disconnect(pool: Pool): Promise<void> {
    await pool.end();
  }

  getModels(_pool: Pool): Record<string, unknown> {
    // Raw pg doesn't have models — return an empty record.
    // Callers access the pool via useTenant().connection.
    return {};
  }
}
```

Usage:

```ts
const adapter = new PgAdapter();
const registry = await TenantRegistry.create({ master: masterStore, adapter });

// In a handler:
const { connection } = useTenant<Pool>();
const result = await connection.query('SELECT * FROM orders WHERE status = $1', ['pending']);
res.json(result.rows);
```

---

## Example: Drizzle ORM

```ts
import type { Adapter, TenantConfig } from '@kosan/core';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export class DrizzleAdapter implements Adapter<NodePgDatabase<typeof schema>> {
  async connect(tenant: TenantConfig) {
    const pool = new Pool({
      host: tenant.host,
      port: tenant.port,
      database: tenant.dbName,
      user: tenant.user,
      password: tenant.password,
    });
    return drizzle(pool, { schema });
  }

  async disconnect(db: NodePgDatabase<typeof schema>): Promise<void> {
    // Drizzle wraps the pool; call end on the underlying pool.
    await (db as unknown as { $client: Pool }).$client.end();
  }

  getModels(db: NodePgDatabase<typeof schema>): Record<string, unknown> {
    return { db };
  }
}
```

Usage:

```ts
import { useTenant } from '@kosan/core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

app.get('/orders', async (_req, res) => {
  const { models } = useTenant<NodePgDatabase<typeof schema>>();
  const db = models['db'] as NodePgDatabase<typeof schema>;
  const orders = await db.select().from(schema.orders);
  res.json(orders);
});
```

---

## Guidelines

### Keep connect() minimal

`connect()` is called once per tenant per process lifecycle (until eviction). Don't do heavy work here — open the connection, verify it, apply any per-connection settings, and return.

### Disconnect must be idempotent

`disconnect()` may be called on an already-closed connection (e.g. if the connection died naturally). Guard against double-close:

```ts
async disconnect(pool: Pool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // Already ended — ignore
  }
}
```

### getModels is called on every request

`getModels(conn)` is called each time a request resolves the tenant and the connection is already cached. Keep it cheap — just return a record derived from the connection, don't do IO here.

### Model factories (optional)

If your ORM uses a factory pattern (like Sequelize's `sequelize.define()`), implement `registerModelFactories`:

```ts
registerModelFactories(factories: ModelFactory<MyConn>[]): void {
  this.factories = factories;
}

async connect(tenant: TenantConfig): Promise<MyConn> {
  const conn = await openConnection(tenant);
  for (const factory of this.factories) {
    factory(conn); // factory registers models on conn
  }
  return conn;
}
```

If your ORM manages models globally (TypeORM entities, Prisma's generated client), omit `registerModelFactories` and use the constructor or a typed getter instead.

---

## Publishing a community adapter

If you build an adapter, consider publishing it as `@kosan-community/<orm>` and opening a PR to add it to the docs.
