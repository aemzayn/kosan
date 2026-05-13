---
---

# Orders App (Sequelize + NestJS)

End-to-end demo: 3 tenants on separate Postgres databases, resolved by subdomain, served by NestJS.

**Source:** [`examples/sequelize-nestjs/`](https://github.com/kosan-dev/kosan/tree/main/examples/sequelize-nestjs)

---

## What it covers

| Feature | Where |
|---|---|
| `KosanModule.forRootAsync` | `app.module.ts` |
| Subdomain-based tenant resolution | `app.module.ts` → `SubdomainResolver` |
| `TenantMiddleware` applied globally | `AppModule.configure()` |
| Excluding admin routes from middleware | `AppModule.configure()` → `.exclude()` |
| `@CurrentTenant()` parameter decorator | `orders/orders.controller.ts` |
| `@InjectRegistry()` constructor decorator | `health/health.controller.ts`, `tenants/tenants.controller.ts` |
| Model registration via `onModuleInit` | `app.service.ts` → `AppService` |
| `onCreate` hook (schema sync) | `app.module.ts` hooks |
| Tenant provisioning script | `provision.ts` |
| Health + cache stats endpoint | `GET /health` |

---

## Running it

```bash
# 1 — start four Postgres containers (master + 3 tenant DBs)
cd examples/sequelize-nestjs
docker-compose up -d

# 2 — install dependencies (from repo root)
pnpm install

# 3 — create tenant rows and sync schemas
pnpm --filter sequelize-nestjs-example provision

# 4 — start the server
pnpm --filter sequelize-nestjs-example start
```

---

## Try it

The server reads the tenant from the **request subdomain**.

```bash
# Orders for tenant "acme"
curl -H "Host: acme.localhost" http://localhost:3000/orders

# Create an order (tenant "acme")
curl -H "Host: acme.localhost" -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"product":"Widget","quantity":2,"total":"19.99"}'

# Tenant "globex" — completely separate database
curl -H "Host: globex.localhost" http://localhost:3000/orders

# Admin: list all tenants (no subdomain required)
curl http://localhost:3000/tenants

# Health / cache stats (no subdomain required)
curl http://localhost:3000/health
```

---

## Project structure

```
src/
  app.module.ts         — KosanModule.forRootAsync + TenantMiddleware wiring
  app.service.ts        — registers model factories via onModuleInit
  main.ts               — NestJS bootstrap
  provision.ts          — seed script (run once after docker-compose up)
  registry.ts           — standalone registry factory (used by provision.ts)
  models/
    order.ts            — Sequelize model factory
  orders/
    orders.controller.ts  — CRUD routes using @CurrentTenant()
    orders.module.ts
  health/
    health.controller.ts  — GET /health using @InjectRegistry()
    health.module.ts
  tenants/
    tenants.controller.ts — GET /tenants + POST /tenants using @InjectRegistry()
    tenants.module.ts
```

---

## Key patterns

### `KosanModule.forRootAsync`

Use this when setup requires async work (e.g., `SequelizeMasterStore.create`):

```ts
KosanModule.forRootAsync({
  useFactory: async () => {
    const masterStore = await SequelizeMasterStore.create(master);
    return {
      resolver: new SubdomainResolver(),
      master: masterStore,
      adapter: new SequelizeAdapter({ ... }),
    };
  },
})
```

### `TenantMiddleware` with route exclusions

```ts
configure(consumer: MiddlewareConsumer) {
  consumer
    .apply(TenantMiddleware)
    .exclude('/tenants(.*)', '/health(.*)')
    .forRoutes('*');
}
```

### Model registration in `onModuleInit`

Because `KosanModule.forRootAsync` creates the registry internally, call
`registerModels` on the injected registry in a service lifecycle hook:

```ts
@Injectable()
export class AppService implements OnModuleInit {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}

  onModuleInit() {
    this.registry.registerModels([OrderModel]);
  }
}
```

### `@CurrentTenant()` in a controller

```ts
@Controller('orders')
export class OrdersController {
  @Get()
  async list(@CurrentTenant() ctx: TenantContextValue) {
    const Order = ctx.models['Order'] as ModelStatic<Model>;
    return Order.findAll();
  }
}
```

---

## Ports

| Service | Port |
|---|---|
| master DB | 5432 |
| acme DB | 5433 |
| globex DB | 5434 |
| initech DB | 5435 |
| HTTP server | 3000 |
