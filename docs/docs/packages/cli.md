---
---

# @kosan/cli

Migration orchestrator that runs database migrations across all active tenants — in parallel, with per-tenant failure isolation.

```bash
npm install -D @kosan/cli
```

---

## kosan migrate

```bash
npx kosan migrate [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `kosan.config.ts` | Path to config file |
| `--concurrency <n>` | `concurrency` from config, else `4` | Max parallel tenant migrations |
| `--tenant <slug>` | all active | Target a single tenant by slug |

### Examples

```bash
# Migrate all active tenants (4 at a time by default)
npx kosan migrate --config kosan.config.ts

# Migrate 10 tenants at a time
npx kosan migrate --concurrency 10

# Migrate only the "acme" tenant
npx kosan migrate --tenant acme
```

---

## Configuration file

Create `kosan.config.ts` (or `.js` / `.mjs`) at the root of your project:

```ts [kosan.config.ts]
import type { KosanConfig } from '@kosan/cli';
import { cipher } from './src/cipher.js'; // same cipher your app gives TenantRegistry

export default {
  master: process.env.MASTER_DATABASE_URL!, // or Sequelize options for the master DB
  migrationsPath: './migrations',           // relative to this file
  migrationsTableName: 'sequelize_meta',    // default
  concurrency: 4,                           // default; --concurrency overrides
  cipher,                                   // only if tenant passwords are encrypted
} satisfies KosanConfig;
```

### KosanConfig

```ts
interface KosanConfig {
  master: string | SequelizeOptions; // connection string or options for the master DB
  migrationsPath: string;
  migrationsTableName?: string;      // default: 'sequelize_meta'
  concurrency?: number;              // default: 4
  cipher?: Cipher;                   // decrypts stored tenant passwords before connecting
}
```

If your app stores tenant passwords encrypted, you **must** pass the same `cipher`. Without it the CLI connects with the encrypted string and authentication fails.

---

## Migration files

Each file in `migrationsPath` must export `up` and `down` functions:

```ts [migrations/001_create_orders.ts]
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
import path from 'node:path';
import { loadConfig, printResults, runMigrate } from '@kosan/cli';

const config = await loadConfig('./kosan.config.ts');

const results = await runMigrate({
  config,
  migrationsDir: path.resolve('./migrations'),
  concurrency: 3,
  tenant: 'acme', // optional: only this tenant
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
  tenantId: string;
  slug: string;
  outcome: 'migrated' | 'up-to-date' | 'failed' | 'skipped';
  applied: string[]; // names of migrations run for this tenant
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

In a CI pipeline, `kosan migrate` exits with code `0` if all tenants succeed and `1` if any tenant fails. Use `--concurrency 1` for sequential runs:

```yaml [.github/workflows/migrate.yml]
- name: Run tenant migrations
  run: npx kosan migrate --concurrency 1
  env:
    MASTER_DATABASE_URL: ${{ secrets.MASTER_DATABASE_URL }}
```
