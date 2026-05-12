---
sidebar_position: 4
---

# Observability

Huni exposes connection pool stats, slow-query detection, structured logging helpers, and a health payload — giving you visibility into what every tenant's database connection is doing.

---

## Connection pool stats

### `registry.getStats()`

Returns a snapshot of the connection cache:

```ts
const stats = registry.getStats();
// {
//   cacheSize: 3,
//   cacheMaxSize: 100,
//   entries: [
//     { tenantId: 'uuid-1', tenantSlug: 'acme',   lastUsed: 1715000000000, idleMs: 120 },
//     { tenantId: 'uuid-2', tenantSlug: 'globex', lastUsed: 1715000001000, idleMs: 80  },
//     { tenantId: 'uuid-3', tenantSlug: 'initech', lastUsed: 1715000002000, idleMs: 40  },
//   ]
// }
```

`idleMs` is the number of milliseconds since this connection was last used. A large `idleMs` relative to `idleTimeoutMs` means the connection will be evicted soon.

### `registry.cache.stats()`

Access the raw cache stats directly:

```ts
const entries = registry.cache.stats(); // CacheStats[]
```

---

## Health endpoint

`getHealthPayload(registry)` builds a serialisable payload suitable for a `/health` route:

```ts
import { getHealthPayload } from '@huni/core';

// Express
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ...getHealthPayload(registry),
  });
});

// Fastify
fastify.get('/health', async () => ({
  status: 'ok',
  ...getHealthPayload(registry),
}));

// Koa
router.get('/health', (ctx) => {
  ctx.body = { status: 'ok', ...getHealthPayload(registry) };
});
```

Example response:

```json
{
  "status": "ok",
  "cacheSize": 2,
  "cacheMaxSize": 100,
  "tenantCount": 2,
  "entries": [
    {
      "tenantId": "a1b2c3d4-...",
      "tenantSlug": "acme",
      "lastUsed": 1715000000000,
      "idleMs": 850
    },
    {
      "tenantId": "e5f6g7h8-...",
      "tenantSlug": "globex",
      "lastUsed": 1714999999000,
      "idleMs": 1850
    }
  ]
}
```

---

## Slow-query detection (Sequelize)

Configure `onSlowQuery` on the adapter to receive a callback whenever a query exceeds the threshold:

```ts
import { SequelizeAdapter } from '@huni/sequelize';
import type { SlowQueryInfo } from '@huni/sequelize';

const adapter = new SequelizeAdapter({
  onSlowQuery: (info: SlowQueryInfo) => {
    console.warn({
      event: 'slow_query',
      tenantId: info.tenantId,
      tenantSlug: info.tenantSlug,
      sql: info.sql,
      durationMs: info.durationMs,
    });
  },
  slowQueryThresholdMs: 500, // fire for queries taking longer than 500ms
});
```

### Integrating with Datadog / OpenTelemetry

```ts
import { metrics } from './otel.js'; // your OpenTelemetry setup

const adapter = new SequelizeAdapter({
  onSlowQuery: (info) => {
    metrics.histogram('db.query.duration', info.durationMs, {
      tenant: info.tenantSlug,
    });
    if (info.durationMs > 1000) {
      metrics.increment('db.slow_query', { tenant: info.tenantSlug });
    }
  },
  slowQueryThresholdMs: 200,
});
```

### Combining with query logging

`onSlowQuery` works alongside the `logging` option — both fire independently:

```ts
const adapter = new SequelizeAdapter({
  logging: (sql, timing) => logger.debug({ sql, timing }, 'query'),
  onSlowQuery: (info) => logger.warn(info, 'slow query'),
  slowQueryThresholdMs: 300,
});
```

---

## Structured log context

`getTenantLogContext()` reads the current tenant from `AsyncLocalStorage` and returns log fields. It returns `{}` outside a tenant context so it's safe to call anywhere.

### Pino

```ts
import pino from 'pino';
import { getTenantLogContext } from '@huni/core';

const baseLogger = pino();

// Attach a child logger per-request after the tenant middleware
app.use((_req, _res, next) => {
  // getTenantLogContext() runs inside the tenant ALS context here
  req.log = baseLogger.child(getTenantLogContext());
  next();
});

// In a handler:
app.post('/orders', async (req, res) => {
  req.log.info('creating order');
  // logs: { "tenantId": "uuid-...", "tenantSlug": "acme", "msg": "creating order" }
});
```

### Winston

```ts
import winston from 'winston';
import { getTenantLogContext } from '@huni/core';

const logger = winston.createLogger({ transports: [new winston.transports.Console()] });

app.use((_req, _res, next) => {
  req.log = logger.child(getTenantLogContext());
  next();
});
```

### Anywhere in your call stack

Because `getTenantLogContext()` reads `AsyncLocalStorage`, it works from deep inside a service layer without passing any context:

```ts
// services/order-service.ts — no request object needed
import { getTenantLogContext } from '@huni/core';
import { logger } from '../logger.js';

export async function processOrder(id: string) {
  logger.info({ ...getTenantLogContext(), orderId: id }, 'processing');
  // ...
}
```

---

## Periodic stats reporting

Poll `getStats()` to push metrics to your monitoring system:

```ts
import { getHealthPayload } from '@huni/core';
import { metrics } from './monitoring.js';

setInterval(() => {
  const { cacheSize, entries } = getHealthPayload(registry);

  metrics.gauge('huni.cache.size', cacheSize);

  for (const entry of entries) {
    metrics.gauge('huni.connection.idle_ms', entry.idleMs, {
      tenant: entry.tenantSlug,
    });
  }
}, 30_000);
```
