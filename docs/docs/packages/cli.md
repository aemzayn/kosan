---
sidebar_position: 7
---

# @huni/cli

Migration orchestrator that runs database migrations across all active tenants — in parallel, with per-tenant failure isolation.

```bash
npm install -D @huni/cli
```

---

## huni migrate

```bash
npx huni migrate [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `huni.config.ts` | Path to config file |
| `--concurrency <n>` | `5` | Max parallel tenant migrations |
| `--tenant <slug>` | all active | Target a single tenant by slug |

### Examples

```bash
# Migrate all active tenants (5 at a time)
npx huni migrate --config huni.config.ts

# Migrate 10 tenants at a time
npx huni migrate --concurrency 10

# Migrate only the "acme" tenant
npx huni migrate --tenant acme
```

---

## Configuration file

Create `huni.config.ts` (or `.js` / `.mjs`) at the root of your project:

```ts title="huni.config.ts"
import { Sequelize } from 'sequelize';
import { SequelizeMasterStore } from '@huni/sequelize';
import { SequelizeAdapter } from '@huni/sequelize';
import { TenantRegistry } from '@huni/core';
import type { HuniConfig } from '@huni/cli';

const master = new Sequelize(process.env.MASTER_DATABASE_URL!, { logging: false });
const masterStore = await SequelizeMasterStore.create(master);
const adapter = new SequelizeAdapter({ defaultDialect: 'postgres' });
const registry = await TenantRegistry.create({ master: masterStore, adapter });

const config: HuniConfig = {
  registry,
  migrationsPath: './migrations',          // directory containing migration files
  migrationsTableName: 'sequelize_meta',   // default
  concurrency: 5,                          // default — overridden by --concurrency flag
};

export default config;
```

### HuniConfig

```ts
interface HuniConfig {
  registry: TenantRegistry;
  migrationsPath: string;
  migrationsTableName?: string; // default: 'sequelize_meta'
  concurrency?: number;         // default: 5
}
```

---

## Migration files

Each file in `migrationsPath` must export `up` and `down` functions:

```ts title="migrations/001_create_orders.ts"
import type { QueryInterface, DataTypes } from 'sequelize';

export async function up(qi: QueryInterface): Promise<void> {
  await qi.createTable('orders', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    description: { type: DataTypes.STRING, allowNull: false },
    total:       { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    status: {
      type: DataTypes.ENUM('pending', 'paid', 'cancelled'),
      defaultValue: 'pending',
    },
    createdAt: { type: DataTypes.DATE },
    updatedAt: { type: DataTypes.DATE },
  });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.dropTable('orders');
}
```

Files are sorted alphabetically — use a numeric prefix (`001_`, `002_`, …) to control order.

Supported extensions: `.ts`, `.js`, `.mjs`, `.cjs`.

---

## Result output

After running, the CLI prints a table:

```
Tenant       Outcome    Applied    Duration
-----------  ---------  ---------  --------
acme         ok         2          312ms
globex       ok         2          289ms
initech      error      0          41ms

Error for initech: connect ECONNREFUSED 192.168.1.100:5432
```

- **Outcome**: `ok` or `error`
- **Applied**: number of migrations that ran
- **Duration**: wall-clock time for that tenant

Failed tenants do not stop other tenants from completing.

---

## Programmatic API

You can run migrations from application code without the CLI:

```ts
import { runMigrate, loadMigrationsFromDir, printResults } from '@huni/cli';
import { Sequelize } from 'sequelize';

const migrations = loadMigrationsFromDir('./migrations', Sequelize);

const results = await runMigrate({
  registry,
  migrations,
  concurrency: 3,
  migrationsTableName: 'sequelize_meta',
});

printResults(results);
```

### `Migration` interface

```ts
interface Migration {
  name: string;
  up: (qi: QueryInterface) => Promise<void>;
  down: (qi: QueryInterface) => Promise<void>;
}
```

### `TenantMigrationResult`

```ts
interface TenantMigrationResult {
  tenant: TenantConfig;
  outcome: 'ok' | 'error';
  applied: number;
  durationMs: number;
  error?: Error;
}
```

---

## Using with a custom logger

Pass a `logger` to `printResults` to redirect output:

```ts
import pino from 'pino';

const logger = pino();

printResults(results, {
  log: (line) => logger.info(line),
});
```

---

## CI integration

In a CI pipeline, `huni migrate` exits with code `0` if all tenants succeed and `1` if any tenant fails. Use `--concurrency 1` for sequential runs:

```yaml title=".github/workflows/migrate.yml"
- name: Run tenant migrations
  run: npx huni migrate --concurrency 1
  env:
    MASTER_DATABASE_URL: ${{ secrets.MASTER_DATABASE_URL }}
```
