---
---

# @kosan/core

The ORM-agnostic foundation. Contains the registry, connection cache, request context, and resolver interfaces. All other packages depend on this one.

```bash
npm install @kosan/core
```

---

## TenantRegistry

The central coordinator. Owns the master store, connection cache, and lifecycle hooks.

### `TenantRegistry.create(options)`

```ts
import { TenantRegistry } from '@kosan/core';

const registry = await TenantRegistry.create({
  master,        // MasterStore implementation
  adapter,       // Adapter<TConn> implementation
  cache: {
    maxSize: 100,          // default: 100
    idleTimeoutMs: 1_800_000, // default: 30 min
  },
  cipher,        // optional Cipher for credential encryption
  hooks: {
    onCreate,    // optional lifecycle hooks
    onDelete,
    onSuspend,
  },
});
```

### Tenant CRUD

```ts
// Create
const tenant = await registry.createTenant({
  slug: 'acme',
  host: 'db.acme.com',
  port: 5432,
  dbName: 'acme',
  user: 'app',
  password: 'secret',
  meta: { plan: 'enterprise' },
});

// Read
const tenant = await registry.getTenant(id);          // by id
const tenants = await registry.listTenants();         // all
const active = await registry.listTenants({ status: 'active' });

// Update
await registry.updateTenant(id, { host: 'new-host.db.com' });

// Suspend (evicts cached connection, triggers onSuspend hook)
await registry.suspendTenant(id);

// Delete (evicts cached connection, triggers onDelete hook)
await registry.deleteTenant(id);
```

### Resolution (used by middleware)

```ts
// Returns TenantContextValue — used internally by middleware
const ctx = await registry.resolveBySlug('acme');
const ctx = await registry.resolveById('uuid-...');
```

### Model registration

```ts
registry.registerModels([OrderModel, UserModel]);
```

### Observability

```ts
const stats = registry.getStats();
// {
//   cacheSize: 3,
//   cacheMaxSize: 100,
//   entries: [
//     { tenantId: '...', tenantSlug: 'acme', lastUsed: 1715000000000, idleMs: 4200 },
//     ...
//   ]
// }
```

### Shutdown

```ts
// Gracefully closes all cached connections.
await registry.shutdown();
```

---

## ConnectionCache

Manages open connections with LRU eviction and idle-timeout sweeping. Exposed on `registry.cache`.

```ts
const cache = registry.cache;

cache.size;                     // number of open connections
cache.maxSize;                  // configured limit
cache.has('tenant-id');         // boolean
cache.stats();                  // CacheStats[]
await cache.evict('tenant-id'); // close one connection
await cache.disconnectAll();    // close all (called by registry.shutdown())
```

### `CacheStats`

```ts
interface CacheStats {
  tenantId: string;
  tenantSlug: string;
  lastUsed: number;  // Unix ms timestamp
  idleMs: number;    // ms since last use
}
```

---

## TenantContext

Request-scoped context powered by `AsyncLocalStorage`. Once the middleware runs `runWithTenant(ctx, fn)`, any code inside `fn` — regardless of call depth — can call `useTenant()` to get the current tenant's connection and models.

### `runWithTenant(ctx, fn)`

```ts
import { runWithTenant } from '@kosan/core';

// Used internally by middleware — you rarely call this directly.
await runWithTenant({ tenant, connection, models }, async () => {
  // Everything inside this closure has access to useTenant().
  await processOrder();
});
```

### `useTenant<TConn>()`

```ts
import { useTenant } from '@kosan/core';

function processOrder() {
  const { tenant, connection, models } = useTenant();
  // tenant   — TenantConfig (id, slug, host, …)
  // connection — raw ORM connection (Sequelize instance, PrismaClient, …)
  // models   — record of registered models
}
```

Throws `Error` if called outside a tenant context.

### `getCurrentTenant()`

```ts
import { getCurrentTenant } from '@kosan/core';

// Returns TenantConfig | undefined — safe to call anywhere, won't throw.
const tenant = getCurrentTenant();
```

### `wrapWithTenantContext(ctx, callback)` {#wrapWithTenantContext}

For frameworks with callback-style middleware (Fastify's `onRequest` hook). Runs `callback` inside `storage.run(ctx, callback)` so the framework's continuation inherits the context.

```ts
import { wrapWithTenantContext } from '@kosan/core';

// Fastify example (simplified):
fastify.addHook('onRequest', (req, reply, done) => {
  wrapWithTenantContext(tenantCtx, done);
});
```

---

## Resolvers

Built-in implementations of the `Resolver` interface.

### SubdomainResolver

Extracts the first subdomain label and uses it as the tenant slug.

```ts
import { SubdomainResolver } from '@kosan/core';

// acme.myapp.com  →  "acme"
// www.myapp.com   →  null (configured via ignoredSubdomains)
const resolver = new SubdomainResolver({
  ignoredSubdomains: ['www', 'api', 'app'], // default: ['www']
});
```

### HeaderResolver

Reads a custom HTTP header.

```ts
import { HeaderResolver } from '@kosan/core';

// X-Tenant-ID: acme  →  "acme"
const resolver = new HeaderResolver('X-Tenant-ID');
```

### PathResolver

Extracts a URL path segment by index.

```ts
import { PathResolver } from '@kosan/core';

// /acme/orders  →  "acme"  (segment 0)
// /api/acme/v1  →  "acme"  (segment 1)
const resolver = new PathResolver({ segment: 0 });
```

### Custom resolver

Pass a plain async function anywhere a `Resolver` is accepted:

```ts
app.use(tenantMiddleware({
  registry,
  resolver: async (req) => {
    // Extract slug from a JWT claim, session, or any other source.
    const payload = verifyToken(req.headers.authorization);
    return payload?.tenantSlug ?? null;
  },
}));
```

---

## Observability helpers

### `getTenantLogContext()`

Returns structured log fields for the current tenant. Returns `{}` when called outside a tenant context (safe to call anywhere).

```ts
import { getTenantLogContext } from '@kosan/core';
import pino from 'pino';

const logger = pino();

app.use((req, res, next) => {
  req.log = logger.child(getTenantLogContext());
  next();
});

// Inside a handler:
// req.log.info('order created')
// → { tenantId: 'uuid-...', tenantSlug: 'acme', msg: 'order created' }
```

### `getHealthPayload(registry)`

Serialisable snapshot of the cache state — drop it directly into a `/health` response.

```ts
import { getHealthPayload } from '@kosan/core';

app.get('/health', (_req, res) => {
  res.json(getHealthPayload(registry));
});

// Response:
// {
//   "cacheSize": 3,
//   "cacheMaxSize": 100,
//   "tenantCount": 3,
//   "entries": [
//     { "tenantId": "...", "tenantSlug": "acme", "lastUsed": 1715000000000, "idleMs": 120 }
//   ]
// }
```

---

## Type reference

```ts
interface TenantConfig {
  id: string;
  slug: string;
  host: string;
  port: number;
  dbName: string;
  user: string;
  password: string;
  status: 'active' | 'suspended' | 'deleted';
  meta?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

interface MasterStore {
  findAll(filter?: { status?: TenantStatus }): Promise<TenantConfig[]>;
  findBySlug(slug: string): Promise<TenantConfig | null>;
  findById(id: string): Promise<TenantConfig | null>;
  create(data: CreateTenantInput): Promise<TenantConfig>;
  update(id: string, data: UpdateTenantInput): Promise<TenantConfig>;
  delete(id: string): Promise<void>;
}

interface Adapter<TConn> {
  connect(tenant: TenantConfig): Promise<TConn>;
  disconnect(conn: TConn): Promise<void>;
  getModels(conn: TConn): Record<string, unknown>;
  registerModelFactories?(factories: ModelFactory<TConn>[]): void;
}

interface Resolver {
  resolve(req: unknown): string | null | Promise<string | null>;
}

interface TenantContextValue<TConn = unknown> {
  tenant: TenantConfig;
  connection: TConn;
  models: Record<string, unknown>;
}

interface Cipher {
  encrypt(plain: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

interface LifecycleHooks<TConn> {
  onCreate?(tenant: TenantConfig, conn: TConn): Promise<void>;
  onDelete?(tenant: TenantConfig): Promise<void>;
  onSuspend?(tenant: TenantConfig): Promise<void>;
}
```

---

## Error classes

```ts
import { TenantNotFoundError, TenantNotActiveError } from '@kosan/core';

try {
  await registry.resolveBySlug('unknown');
} catch (err) {
  if (err instanceof TenantNotFoundError) {
    // slug or id was not found in the master store
  }
  if (err instanceof TenantNotActiveError) {
    console.log(err.status); // 'suspended' | 'deleted'
  }
}
```
