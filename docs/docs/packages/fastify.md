---
---

# @kosan/fastify

Fastify plugin that resolves the tenant on every request and scopes the connection to `AsyncLocalStorage` so `useTenant()` is available in route handlers.

```bash
npm install @kosan/fastify fastify-plugin
```

---

## Registration

```ts
import Fastify from 'fastify';
import tenantPlugin from '@kosan/fastify';
import { SubdomainResolver } from '@kosan/core';
import { registry } from './registry.js';

const fastify = Fastify();

await fastify.register(tenantPlugin, {
  registry,
  resolver: new SubdomainResolver(),
});
```

The plugin uses `fastify-plugin` so the tenant hook applies globally — it is not scoped to a sub-route.

---

## Options

```ts
interface TenantPluginOptions {
  registry: TenantRegistry;
  resolver: Resolver | ((request: FastifyRequest) => string | null | Promise<string | null>);
  onMissingTenant?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
}
```

| Option | Default | Description |
|---|---|---|
| `registry` | — | Required |
| `resolver` | — | Required. `Resolver` instance or plain async function |
| `onMissingTenant` | Responds `400` | Called when resolver returns `null` |

### Error replies

| Situation | Default response |
|---|---|
| Resolver returns `null` | `400 { "error": "Tenant identifier missing from request." }` |
| Tenant not found | `404 { "error": "Tenant not found: <slug>" }` |
| Tenant suspended / deleted | `403 { "error": "Tenant \"...\" is not active (status: …)" }` |

---

## Examples

### Header resolver

```ts
import { HeaderResolver } from '@kosan/core';

await fastify.register(tenantPlugin, {
  registry,
  resolver: new HeaderResolver('X-Tenant-ID'),
});
```

### Custom async resolver

```ts
await fastify.register(tenantPlugin, {
  registry,
  resolver: async (request) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    const { tenantSlug } = await verifyJwt(token);
    return tenantSlug;
  },
});
```

### Custom missing-tenant handler

```ts
await fastify.register(tenantPlugin, {
  registry,
  resolver: new SubdomainResolver(),
  onMissingTenant: async (_request, reply) => {
    await reply.status(401).send({ error: 'Authentication required.' });
  },
});
```

### Scoping to a sub-router

Wrap routes that need a tenant inside a plugin registered with a prefix, and register the tenant plugin only inside that plugin:

```ts
fastify.register(async (app) => {
  await app.register(tenantPlugin, { registry, resolver });

  app.get('/orders', async () => {
    const { models } = useTenant();
    const Order = models['Order'] as ModelStatic<Model>;
    return Order.findAll();
  });
}, { prefix: '/api' });
```

---

## Using the context

```ts
import { useTenant } from '@kosan/core';

fastify.get('/profile', async (_request, _reply) => {
  const { tenant, models } = useTenant();
  return { slug: tenant.slug, plan: tenant.meta?.plan };
});
```

---

## How context propagation works

Fastify's hook system uses callbacks (`done`) rather than promises for the `onRequest` stage. This matters because `AsyncLocalStorage.enterWith()` doesn't cross the boundary between the hook callback and the route handler — only `storage.run()` does.

The plugin uses `wrapWithTenantContext(ctx, done)` which calls `storage.run(ctx, done)` synchronously. Fastify schedules the next lifecycle step from inside `done()`, which means the entire handler chain inherits the storage context:

```
onRequest hook
  └── storage.run(ctx, done)  ← context starts here
        └── done()            ← Fastify continues from here, still inside storage.run
              └── route handler ← useTenant() works
```

You do not need to do anything special — this is handled automatically by the plugin.

---

## Compatibility

Supports Fastify 4.x and 5.x. Tested with `fastify-plugin` 4.x.
