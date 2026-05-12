---
sidebar_position: 6
---

# @huni/koa

Koa middleware that resolves the tenant on every request and makes `useTenant()` available in downstream middleware and route handlers.

```bash
npm install @huni/koa
```

---

## tenantMiddleware

```ts
import Koa from 'koa';
import { tenantMiddleware } from '@huni/koa';
import { SubdomainResolver } from '@huni/core';
import { registry } from './registry.js';

const app = new Koa();

app.use(
  tenantMiddleware({
    registry,
    resolver: new SubdomainResolver(),
  }),
);
```

### Options

```ts
interface TenantMiddlewareOptions {
  registry: TenantRegistry;
  resolver: Resolver | ((ctx: Context) => string | null | Promise<string | null>);
  onMissingTenant?: (ctx: Context) => void | Promise<void>;
}
```

| Option | Default | Description |
|---|---|---|
| `registry` | — | Required |
| `resolver` | — | Required. `Resolver` instance or plain async function |
| `onMissingTenant` | Responds `400` | Called when resolver returns `null` |

### Error responses

| Situation | Default |
|---|---|
| Resolver returns `null` | `400 { "error": "Tenant identifier missing from request." }` |
| Tenant not found | `404 { "error": "Tenant not found: <slug>" }` |
| Tenant suspended / deleted | `403 { "error": "Tenant \"...\" is not active (status: …)" }` |

---

## Examples

### Header resolver

```ts
import { HeaderResolver } from '@huni/core';

app.use(tenantMiddleware({
  registry,
  resolver: new HeaderResolver('X-Tenant-ID'),
}));
```

### Path resolver

```ts
import { PathResolver } from '@huni/core';

// /acme/orders → "acme"
app.use(tenantMiddleware({
  registry,
  resolver: new PathResolver({ segment: 0 }),
}));
```

### Custom resolver function

```ts
app.use(tenantMiddleware({
  registry,
  resolver: async (ctx) => {
    const token = ctx.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    const payload = await verifyJwt(token);
    return payload.tenantSlug;
  },
}));
```

### Custom missing-tenant handler

```ts
app.use(tenantMiddleware({
  registry,
  resolver: new SubdomainResolver(),
  onMissingTenant: (ctx) => {
    ctx.status = 401;
    ctx.body = { error: 'Please log in.' };
  },
}));
```

### Using with @koa/router

```ts
import Router from '@koa/router';
import { useTenant } from '@huni/core';

const router = new Router();

router.get('/orders', async (ctx) => {
  const { models } = useTenant();
  const Order = models['Order'] as ModelStatic<Model>;
  ctx.body = await Order.findAll();
});

app.use(tenantMiddleware({ registry, resolver }));
app.use(router.routes());
app.use(router.allowedMethods());
```

---

## Context propagation

Koa's `next()` returns a `Promise`, which means `runWithTenant(ctx, () => next())` works cleanly — the entire downstream middleware chain runs inside the `AsyncLocalStorage.run()` scope. No callback tricks needed unlike Fastify.

```
app.use(tenantMiddleware(...))
  └── runWithTenant(ctx, () => next())
        └── next()                   ← downstream middleware
              └── useTenant()        ← works anywhere downstream
```

---

## Structured logging

```ts
import pino from 'pino';
import { getTenantLogContext } from '@huni/core';

const logger = pino();

app.use(async (ctx, next) => {
  ctx.log = logger.child(getTenantLogContext());
  await next();
});
```
