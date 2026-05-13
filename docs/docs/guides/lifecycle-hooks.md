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
    onCreate: async (tenant, conn) => { /* … */ },
    onDelete: async (tenant) => { /* … */ },
    onSuspend: async (tenant) => { /* … */ },
  },
});
```

---

## onCreate

Called after a tenant row is inserted into the master DB. Receives the new `TenantConfig` and a **throw-away** connection that is opened for provisioning and closed immediately after the hook returns.

```ts
hooks: {
  async onCreate(tenant, conn) {
    // conn is a fresh connection to the new tenant's database.
    // Use it to create the schema and run initial migrations.

    // Option A — Sequelize sync (for development / demos)
    await conn.sync({ force: false });

    // Option B — Run your migration tool (recommended for production)
    await runMigrationsForTenant(tenant, conn);

    // Option C — Copy a template database (Postgres-specific)
    await masterConn.query(
      `CREATE DATABASE "${tenant.dbName}" TEMPLATE tenant_template`
    );
  },
},
```

The connection passed to `onCreate` is isolated from the connection cache. It will not be reused — it exists only for provisioning.

### Provisioning a new Postgres database

If your tenants each need a fresh database created:

```ts
async onCreate(tenant, conn) {
  // Use the master connection (not conn) to CREATE the database.
  await master.query(`CREATE DATABASE "${tenant.dbName}"`);

  // Now use conn (which already points to the new DB) to create the schema.
  await conn.sync();
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
