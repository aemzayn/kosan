# Milestones

## Milestone 1 — Working end-to-end demo

Build the library from core outward, ending in a runnable demo against real Postgres.

---

### 1.1 `@huni/core` ✅

> ORM-agnostic: registry, cache, context, resolvers. No framework dependencies.

- [x] `TenantRegistry` — create / resolve / suspend / delete / update tenants
- [x] `ConnectionCache` — LRU eviction, idle-timeout sweeping, per-tenant stats
- [x] `TenantContext` — `AsyncLocalStorage`, `runWithTenant()`, `useTenant()`, `getCurrentTenant()`
- [x] Resolvers — `SubdomainResolver`, `HeaderResolver`, `PathResolver`
- [x] Types — `MasterStore`, `Adapter`, `Cipher`, `LifecycleHooks`, `Resolver`
- [x] Full Vitest suite — 52/52 tests passing
- [x] In-memory fakes — `InMemoryMasterStore`, `FakeAdapter` (used in tests)

---

### 1.2 `@huni/sequelize` ✅

> Sequelize v6 adapter — connection factory, model registration, master store.

- [x] `SequelizeMasterStore` — implements `MasterStore` using a Sequelize model (`Tenant` table)
- [x] `SequelizeAdapter` — implements `Adapter<Sequelize>`, handles instance creation, dialect config, pool config, model factory application, graceful disconnect
- [x] `AdapterContext` type — `{ sequelize: Sequelize }` passed to model factories
- [x] Full Vitest suite — 20/20 tests with SQLite in-memory master DB

---

### 1.3 `@huni/express` ✅

> Thin Express middleware — resolves tenant, runs handler inside `runWithTenant`.

- [x] `tenantMiddleware(options)` — calls resolver, calls `registry.resolveBySlug`, calls `runWithTenant`, calls `next()`
- [x] Error handling — 404 on `TenantNotFoundError`, 403 on `TenantNotActiveError`, 500 on unexpected errors
- [x] Custom `onMissingTenant` hook
- [x] Accepts `Resolver` instance or plain async/sync function
- [x] Full Vitest suite — 10/10 tests (including concurrent context isolation)

---

### 1.4 `examples/sequelize-express` ✅

> Runnable demo — 3 tenants in Postgres via Docker Compose.

- [x] `docker-compose.yml` — master Postgres + 3 tenant Postgres instances
- [x] Subdomain resolution demo — `acme.localhost`, `globex.localhost`, `initech.localhost`
- [x] Model usage — `Order` model with CRUD routes (list, create, delete)
- [x] Tenant provisioning script (`pnpm provision`) — idempotent, syncs schema via `onCreate` hook
- [x] `GET /health` — cache size + per-tenant stats
- [x] README — how to run locally

---

## Milestone 2 — CLI migration orchestrator ✅

> `@huni/cli` — runs Sequelize migrations across all active tenants.

- [x] `huni migrate` command — iterates active tenants, runs migrations per tenant
- [x] `--concurrency N` flag — parallel migrations with failure isolation (per-tenant errors captured, siblings continue)
- [x] `--tenant <slug>` flag — target a single tenant
- [x] `HuniConfig` type — `master`, `migrationsPath`, `migrationsTableName`, `concurrency`
- [x] Config loaded via `jiti` (supports `.ts`, `.js`, `.mjs` config files)
- [x] Per-tenant result summary — `printResults()` table with outcome, applied count, duration
- [x] `Migration` interface — `name`, `up(qi)`, `down(qi)` — decoupled from file loading
- [x] `loadMigrationsFromDir()` — reads directory, sorts alphabetically, lazy dynamic import
- [x] `withConcurrency()` pool — bounded parallel execution, results in input order
- [x] Tests — 16/16 (7 pool tests, 9 runner/printer tests with in-memory SQLite)

---

## Milestone 3 — Prisma adapter ✅

> `@huni/prisma` — adapter for Prisma Client.

- [x] `PrismaAdapter` — one `PrismaClient` per tenant, datasource URL override via `buildUrl`
- [x] `PrismaMasterStore` — master tenant table via structural `TenantDelegate` type (pass `prisma.tenant`)
- [x] `usePrisma<TClient>()` — typed shortcut that returns the client from `useTenant().models.prisma`
- [x] No hard dependency on `@prisma/client` — fully generic, peer dep only
- [x] `TENANT_PRISMA_SCHEMA` export — copy-pasteable Prisma schema snippet
- [x] `PrismaClientConstructor` type — typed constructor interface for the generated client
- [x] Tests — 26/26 (15 store tests, 11 adapter+context tests, full registry integration)

---

## Milestone 4 — Fastify plugin & Koa middleware ✅

- [x] `@huni/fastify` — Fastify plugin (callback-based `onRequest` hook; `wrapWithTenantContext` for correct async propagation)
- [x] `@huni/koa` — Koa middleware (`runWithTenant` wrapping `next()` — works cleanly with Koa's Promise chain)
- [x] Core addition: `wrapWithTenantContext(value, callback)` — calls `callback` inside `storage.run()` for frameworks that can't use async closures
- [x] Tests — 10 Fastify + 11 Koa (happy path, errors, resolver types, concurrent isolation)

---

## Milestone 5 — Observability & health ✅

- [x] `CacheStats` extended with `tenantSlug` and `idleMs` fields
- [x] `ConnectionCache.maxSize` getter — publicly readable
- [x] `TenantRegistry.getStats()` — returns `{ cacheSize, cacheMaxSize, entries }`
- [x] `getTenantLogContext()` — reads current tenant from `AsyncLocalStorage`, returns `{ tenantId, tenantSlug }` (empty object outside context)
- [x] `getHealthPayload(registry)` — builds a serialisable health payload from cache state
- [x] `SlowQueryInfo` type + `onSlowQuery` callback + `slowQueryThresholdMs` option in `SequelizeAdapterOptions`
- [x] Slow-query detection in `SequelizeAdapter` via wrapped `logging` + `benchmark: true`
- [x] Tests — 7 observability tests in `@huni/core`, 5 slow-query tests in `@huni/sequelize`
- [x] All exports added to `@huni/core` and `@huni/sequelize` index files

---

## Milestone 6 — Docs site

> VitePress documentation.

- [ ] Getting started guide
- [ ] API reference (auto-generated from TypeScript)
- [ ] Adapter authoring guide
- [ ] Deployment guide (subdomain setup, credential encryption, Docker)
- [ ] Migration guide

---

## Milestone 7 — NestJS support ✅

> `@huni/nestjs` — NestJS module, guard, and decorator integration.

- [x] `HuniModule.forRoot` — synchronous registration
- [x] `HuniModule.forRootAsync` — async registration (useFactory, inject)
- [x] `TenantMiddleware` — NestJS middleware wrapping `runWithTenant(ctx, next)`
- [x] `TenantGuard` — optional guard asserting tenant context is present
- [x] `@CurrentTenant()` — parameter decorator returning `TenantContextValue`
- [x] `@InjectRegistry()` — constructor decorator injecting the `TenantRegistry`
- [x] Tests — 16/16 (HuniModule structure, TenantGuard, TenantMiddleware with context isolation)
- [x] Example — `examples/sequelize-nestjs/` — runnable NestJS app with Docker Compose, 3 tenants
- [x] Docs — `docs/docs/packages/nestjs.md` updated + `docs/docs/examples/sequelize-nestjs.md`
