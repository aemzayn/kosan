---
---

# @huni/express

Express middleware that resolves the tenant for every request and makes `useTenant()` available inside handlers.

```bash
npm install @huni/express
```

---

## tenantMiddleware

```ts
import { tenantMiddleware } from '@huni/express';

app.use(tenantMiddleware({
  registry,
  resolver,
  onMissingTenant, // optional
}));
```

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `registry` | `TenantRegistry` | Yes | The registry created by `TenantRegistry.create()` |
| `resolver` | `Resolver \| (req) => string \| null` | Yes | How to extract the tenant slug from the request |
| `onMissingTenant` | `(req, res) => void` | No | Called when the resolver returns `null`. Default: responds `400` |

### Error responses

| Situation | Default response |
|---|---|
| Resolver returns `null` | `400 { "error": "Tenant identifier missing from request." }` |
| Tenant not found in master DB | `404 { "error": "Tenant not found: <slug>" }` |
| Tenant is suspended or deleted | `403 { "error": "Tenant \"<slug>\" is not active (status: suspended)" }` |
| Unexpected error | `500 { "error": "Internal server error." }` |

---

## Examples

### Subdomain resolution

```ts
import express from 'express';
import { tenantMiddleware } from '@huni/express';
import { SubdomainResolver } from '@huni/core';

const app = express();

app.use(tenantMiddleware({
  registry,
  resolver: new SubdomainResolver(),
}));
```

Requests to `acme.myapp.com` → slug `"acme"`.

### Header resolution

```ts
app.use(tenantMiddleware({
  registry,
  resolver: new HeaderResolver('X-Tenant-ID'),
}));
```

### Custom resolver function

Pass an async function anywhere a resolver is accepted:

```ts
app.use(tenantMiddleware({
  registry,
  resolver: async (req) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    const { tenantSlug } = await verifyJwt(token);
    return tenantSlug;
  },
}));
```

### Custom missing-tenant handler

```ts
app.use(tenantMiddleware({
  registry,
  resolver: new SubdomainResolver(),
  onMissingTenant: (req, res) => {
    // Redirect to marketing site, show a tenant picker, etc.
    res.redirect('https://myapp.com/login');
  },
}));
```

### Scoping middleware to specific routes

Mount the middleware only on routes that require a tenant:

```ts
const app = express();

// Public routes — no tenant needed
app.get('/health', healthHandler);
app.post('/signup', signupHandler);

// Tenant routes
const tenantRouter = express.Router();
tenantRouter.use(tenantMiddleware({ registry, resolver }));
tenantRouter.get('/orders', ordersHandler);
tenantRouter.post('/orders', createOrderHandler);

app.use('/api', tenantRouter);
```

---

## Using the context in handlers

```ts
import { useTenant } from '@huni/core';

app.get('/orders', async (req, res) => {
  const { tenant, models } = useTenant();

  // tenant — the TenantConfig row from the master DB
  // models  — Record<string, unknown> with whatever your model factories registered
  const Order = models['Order'] as ModelStatic<Model>;

  const orders = await Order.findAll({
    where: { status: 'pending' },
    order: [['createdAt', 'DESC']],
  });

  res.json({ tenant: tenant.slug, orders });
});
```

### Accessing tenant info without models

```ts
import { getCurrentTenant } from '@huni/core';

// Safe to call outside a tenant context — returns undefined instead of throwing.
const tenant = getCurrentTenant();
console.log(tenant?.slug);
```

---

## Structured logging with Pino

```ts
import pino from 'pino';
import { getTenantLogContext } from '@huni/core';

const baseLogger = pino();

// After tenantMiddleware, attach a child logger to the request.
app.use((req, _res, next) => {
  req.log = baseLogger.child(getTenantLogContext());
  next();
});

// In handlers:
app.get('/orders', async (req, res) => {
  req.log.info('listing orders');
  // → { "tenantId": "uuid-...", "tenantSlug": "acme", "msg": "listing orders" }
});
```

---

## Health endpoint

```ts
import { getHealthPayload } from '@huni/core';

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ...getHealthPayload(registry),
  });
});
```
