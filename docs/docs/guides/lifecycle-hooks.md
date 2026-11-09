---
---

# Lifecycle Hooks

Lifecycle hooks let you run custom logic when tenants are created, suspended, or deleted. They are the right place to provision physical databases, run initial migrations, send notifications, or archive data.

---

## Registering hooks

Pass `hooks` when calling `TenantRegistry.create()`:

```ts
import { TenantRegistry } from '@kosan/core';

const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  hooks: {
    onProvision: async (tenant) => { /* … */ },
    onCreate: async (tenant, conn) => { /* … */ },
    onDelete: async (tenant) => { /* … */ },
    onSuspend: async (tenant) => { /* … */ },
  },
});
```

---

## How `createTenant()` runs the hooks

1. The master row is inserted with status `provisioning`, so requests can't resolve the tenant while it is being set up.
2. `onProvision(tenant)` runs. **No connection is opened yet**, so this is where you create the physical database.
3. A throw-away connection to the tenant database is opened and `onCreate(tenant, conn)` runs: schema, migrations, seed data.
4. The status is set to what you asked for (default `active`) and the tenant becomes resolvable.

If any step throws, including opening the connection, the master row is **deleted** and the error is rethrown from `createTenant()`. If that delete also fails, or the process crashes mid-way, the row is left with status `provisioning`. Find leftovers with `registry.listTenants({ status: 'provisioning' })` and remove them with `deleteTenant()`.

Every hook, including `onSuspend` and `onDelete`, receives decrypted credentials.

Kosan never creates databases on its own. Provisioning only happens if you write an `onProvision` hook.

---

## onProvision

Runs before Kosan connects to the tenant database. Use your own admin connection to create it:

```ts
import { Sequelize } from 'sequelize';

const admin = new Sequelize(process.env.ADMIN_DATABASE_URL!);

hooks: {
  async onProvision(tenant) {
    await admin.query(`CREATE DATABASE "${tenant.dbName}"`);
    // Or copy a template: CREATE DATABASE "x" TEMPLATE tenant_template
  },
},
```

If `onProvision` fails partway (say, after `CREATE DATABASE` but before granting privileges), Kosan removes the master row but cannot undo your side effects. Clean up inside the hook:

```ts
async onProvision(tenant) {
  await admin.query(`CREATE DATABASE "${tenant.dbName}"`);
  try {
    await admin.query(`GRANT ALL ON DATABASE "${tenant.dbName}" TO "${tenant.user}"`);
  } catch (err) {
    await admin.query(`DROP DATABASE "${tenant.dbName}"`);
    throw err;
  }
},
```

---

## onCreate

Runs after `onProvision`, with a **throw-away** connection to the new tenant database. The connection is closed when the hook returns and is never added to the connection cache.

```ts
hooks: {
  async onCreate(tenant, conn) {
    // Development / demos: create tables from your models
    await conn.sync();

    // Production: run your migrations instead
    await runMigrationsForTenant(tenant, conn);
  },
},
```

---

## onDelete

Called after the tenant row is removed from the master DB and the cached connection is evicted. Receives the (now-deleted) `TenantConfig`.

```ts
hooks: {
  async onDelete(tenant) {
    // Archive data to cold storage
    await archiveService.archive(tenant.id);

    // Optionally drop the physical database
    await master.query(`DROP DATABASE IF EXISTS "${tenant.dbName}"`);

    // Send a notification
    await notifier.send({
      event: 'tenant.deleted',
      tenantId: tenant.id,
      slug: tenant.slug,
    });
  },
},
```

The physical database is not dropped automatically — you must do it explicitly if you want that behaviour. This is intentional: production environments often require a manual review step before irreversible destructive actions.

---

## onSuspend

Called after `registry.suspendTenant(id)` updates the tenant's status to `'suspended'` and evicts the cached connection. Receives the updated `TenantConfig`.

```ts
hooks: {
  async onSuspend(tenant) {
    // Notify the tenant's users
    await emailService.send({
      to: tenant.meta?.['billingEmail'] as string,
      template: 'account-suspended',
      data: { slug: tenant.slug },
    });

    // Revoke active sessions
    await sessionStore.revokeAll(tenant.id);
  },
},
```

Suspended tenants are blocked at the middleware level — `resolveBySlug` throws `TenantNotActiveError`, which the framework adapters translate to a `403` response.

---

## Error handling

If a hook throws, the error propagates to the caller:

```ts
try {
  await registry.createTenant(input);
} catch (err) {
  // If onCreate throws, the tenant row has already been created in the master DB.
  // You may want to clean it up:
  if (err instanceof ProvisioningError) {
    await registry.deleteTenant(tenant.id);
  }
  throw err;
}
```

Consider wrapping critical provisioning steps in retry logic.

---

## Hook execution order

| Operation | Hook | When it runs |
|---|---|---|
| `registry.createTenant()` | `onCreate` | After master insert, before returning |
| `registry.suspendTenant()` | `onSuspend` | After status update and cache eviction |
| `registry.deleteTenant()` | `onDelete` | After master delete and cache eviction |
| `registry.updateTenant()` | _(none)_ | Cache is evicted; no hook |

---

## Full provisioning example

```ts
import { TenantRegistry } from '@kosan/core';
import { SequelizeAdapter, SequelizeMasterStore } from '@kosan/sequelize';
import { runMigrate, loadMigrationsFromDir } from '@kosan/cli';
import { Sequelize } from 'sequelize';

const migrations = loadMigrationsFromDir('./migrations', Sequelize);

const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  hooks: {
    async onCreate(tenant, conn) {
      // 1. Create the database (run as the superuser)
      await superuserConn.query(
        `CREATE DATABASE "${tenant.dbName}" OWNER "${tenant.user}"`
      );

      // 2. Run migrations against the new database
      const results = await runMigrate({
        registry,
        migrations,
        concurrency: 1,
        filter: (t) => t.id === tenant.id,
      });

      if (results[0]?.outcome === 'error') {
        throw results[0].error ?? new Error('Migration failed');
      }
    },

    async onDelete(tenant) {
      await archiveService.archive(tenant.id);
    },

    async onSuspend(tenant) {
      await emailService.notifySuspended(tenant);
    },
  },
});
```
