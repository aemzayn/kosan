---
---

# @huni/nestjs

> **Example:** see [`examples/sequelize-nestjs/`](https://github.com/huni-dev/huni/tree/main/examples/sequelize-nestjs) for a complete runnable demo.

NestJS module that resolves the tenant on every request, scopes the connection via `AsyncLocalStorage`, and provides DI-friendly decorators so `useTenant()` is available in controllers and services.

```bash
npm install @huni/nestjs
```

---

## How it works

NestJS uses Express (or Fastify) under the hood. `@huni/nestjs` registers a **NestJS Middleware** — not a guard — that wraps the entire handler chain inside `runWithTenant()`. This means `useTenant()` is available everywhere downstream: guards, interceptors, pipes, and route handlers.

```
Request → TenantMiddleware
              └── resolves slug
              └── fetches TenantContextValue from registry
              └── runWithTenant(ctx, next)  ← AsyncLocalStorage.run starts here
                        └── NestJS guards
                        └── NestJS interceptors
                        └── Route handler  ← useTenant() works here
```

---

## Registration

### 1. Import `HuniModule`

```ts
// app.module.ts
import { Module, MiddlewareConsumer } from '@nestjs/common';
import { HuniModule, TenantMiddleware } from '@huni/nestjs';
import { SubdomainResolver } from '@huni/core';
import { SequelizeAdapter } from '@huni/sequelize';
import { masterStore } from './master-store.js';

@Module({
  imports: [
    HuniModule.forRoot({
      resolver: new SubdomainResolver(),
      master: masterStore,
      adapter: new SequelizeAdapter({ models: [Order] }),
    }),
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply the tenant middleware to all routes.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

### 2. Use `useTenant()` in a controller

```ts
import { Controller, Get } from '@nestjs/common';
import { useTenant } from '@huni/core';

@Controller('orders')
export class OrdersController {
  @Get()
  async list() {
    const { tenant, models } = useTenant();
    const Order = models['Order'];
    return Order.findAll();
  }
}
```

### 3. Or use the `@CurrentTenant()` parameter decorator

```ts
import { Controller, Get } from '@nestjs/common';
import { CurrentTenant } from '@huni/nestjs';
import type { TenantContextValue } from '@huni/core';

@Controller('orders')
export class OrdersController {
  @Get()
  async list(@CurrentTenant() ctx: TenantContextValue) {
    const Order = ctx.models['Order'];
    return Order.findAll();
  }
}
```

---

## Async registration

When options depend on NestJS's DI (e.g., `ConfigService`):

```ts
HuniModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    resolver: new SubdomainResolver(),
    master: masterStore,
    adapter: new SequelizeAdapter({
      host: config.get('DB_HOST'),
    }),
  }),
})
```

---

## API reference

### `HuniModule.forRoot(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `resolver` | `Resolver` | — | Required. Extracts tenant slug from the request |
| `master` | `MasterStore` | — | Required. Where tenant records live |
| `adapter` | `Adapter` | — | Required. ORM-specific connection factory |
| `missingTenantStatus` | `number` | `404` | HTTP status when tenant not found |
| `onMissingTenant` | `(slug: string) => void` | — | Called before throwing when tenant is missing |
| `cache` | `CacheOptions` | — | LRU cache config |
| `cipher` | `Cipher` | — | Credential decryption |
| `hooks` | `LifecycleHooks` | — | `onCreate`, `onDelete`, `onSuspend` |

### `TenantMiddleware`

NestJS middleware. Apply via `MiddlewareConsumer` in your `AppModule.configure()`. Does the actual tenant resolution and context injection.

### `TenantGuard`

Optional guard that asserts a tenant is in the current context. Throws `UnauthorizedException` if no tenant is found. Use this on routes where `TenantMiddleware` might not be applied.

```ts
@UseGuards(TenantGuard)
@Controller('admin')
export class AdminController { ... }
```

Or globally:

```ts
providers: [{ provide: APP_GUARD, useClass: TenantGuard }]
```

### `@CurrentTenant()`

Parameter decorator. Returns the current `TenantContextValue` via `useTenant()`.

### `@InjectRegistry()`

Property/constructor decorator that injects the `TenantRegistry` instance into a service.

```ts
@Injectable()
export class TenantService {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}
}
```

---

## Inject the registry into a service

```ts
import { Injectable } from '@nestjs/common';
import { InjectRegistry } from '@huni/nestjs';
import { TenantRegistry } from '@huni/core';

@Injectable()
export class TenantProvisioningService {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}

  async provision(input: CreateTenantInput) {
    return this.registry.createTenant(input);
  }
}
```

---

## Error behaviour

| Situation | Response |
|---|---|
| Resolver returns `null` | `HttpException` with `missingTenantStatus` (default 404) |
| Tenant not found | `HttpException` 404 |
| Tenant suspended / deleted | `HttpException` 404 (or `missingTenantStatus`) |
| Unexpected error | Rethrown — handled by NestJS exception filter |

---

---

## Registering model factories

Because `HuniModule` creates the `TenantRegistry` internally, you can't call
`registry.registerModels()` before the DI container is ready. The idiomatic
solution is a lightweight service with `onModuleInit`:

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRegistry } from '@huni/nestjs';
import { TenantRegistry } from '@huni/core';
import { OrderModel } from './models/order';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}

  onModuleInit() {
    this.registry.registerModels([OrderModel]);
  }
}
```

Add it to `AppModule`'s `providers` array and NestJS will call `onModuleInit`
after all providers are resolved.

---

## Compatibility

Requires `@nestjs/common` and `@nestjs/core` ≥ 10.0.0 and `reflect-metadata`.
