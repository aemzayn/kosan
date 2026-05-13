# Kosan — Project Handoff

Everything you need to understand, build, test, and publish this project.

---

## What this is

Kosan is a **database-per-tenant multi-tenancy layer for Node.js**. It fills the gap that no major ORM covers: managing one isolated connection pool per tenant, resolving which tenant owns an HTTP request, propagating that context through the application stack without prop-drilling, and orchestrating schema migrations across all tenants.

The Java ecosystem has Hibernate multi-tenancy. The PHP ecosystem has stancl/tenancy. Node.js has nothing equivalent. Kosan is that thing.

---

## Repository layout

```
kosan/
├── packages/
│   ├── core/         @kosan/core       — registry, cache, context, resolvers
│   ├── sequelize/    @kosan/sequelize  — Sequelize v6 adapter
│   ├── prisma/       @kosan/prisma     — Prisma adapter
│   ├── drizzle/      @kosan/drizzle    — Drizzle ORM adapter
│   ├── express/      @kosan/express    — Express middleware
│   ├── fastify/      @kosan/fastify    — Fastify plugin
│   ├── koa/          @kosan/koa        — Koa middleware
│   ├── nestjs/       @kosan/nestjs     — NestJS module + middleware + decorators
│   └── cli/          @kosan/cli        — Migration orchestrator CLI
├── examples/
│   └── sequelize-express/             — Docker Compose demo
├── docs/                              — Docusaurus site
├── .github/workflows/ci.yml           — CI (test × Node 18/20/22, build, lint)
├── biome.json                         — Lint + format (no ESLint, no Prettier)
├── tsconfig.base.json                 — Shared TypeScript config
├── pnpm-workspace.yaml
└── MILESTONES.md                      — Feature history
```

---

## Tech stack

| Concern | Tool |
|---|---|
| Package manager | pnpm 9 (workspaces) |
| Language | TypeScript 5, strict mode |
| Target | Node ≥ 18 (uses `AsyncLocalStorage`) |
| Module format | ESM primary, CJS interop via tsup |
| Build | tsup (produces `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`) |
| Tests | Vitest |
| Lint / format | Biome (single tool, no ESLint + Prettier) |
| Docs | VitePress 1 (`docs/`) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

---

## Core concepts

### 1 — TenantRegistry

The central object. Created once at startup. Owns:
- `MasterStore` — reads/writes tenant rows (slug, host, port, dbName, user, password, status, meta)
- `ConnectionCache` — LRU + idle-timeout cache of open ORM connections
- `Adapter<TConn>` — opens/closes connections for a specific ORM
- `Cipher` (optional) — encrypts/decrypts passwords at rest
- `LifecycleHooks` — `onCreate`, `onDelete`, `onSuspend`

### 2 — Connection cache

`ConnectionCache` is a `Map<tenantId, CacheEntry>` with:
- LRU eviction when `maxSize` is reached (default 100)
- Per-entry idle timers that evict after `idleTimeoutMs` of inactivity (default 30 min)
- `stats()` returning `{ tenantId, tenantSlug, lastUsed, idleMs }[]`

### 3 — Request context (AsyncLocalStorage)

`runWithTenant(ctx, fn)` stores `{ tenant, connection, models }` in `AsyncLocalStorage`.

Inside any code running within `fn` (at any call depth), `useTenant()` retrieves it.

Framework adapters wrap `next()` / `done()` inside `storage.run()`:
- **Express / Koa**: async — `runWithTenant(ctx, () => next())` works directly
- **Fastify**: callback-based — must call `done` inside `storage.run(ctx, done)` via `wrapWithTenantContext(ctx, done)`. Using `enterWith()` does **not** work for Fastify (context leaks and doesn't cross hook→handler boundary)

### 4 — Adapter pattern

Each ORM package implements `Adapter<TConn>`:

```ts
interface Adapter<TConn> {
  connect(tenant: TenantConfig): Promise<TConn>;
  disconnect(conn: TConn): Promise<void>;
  getModels(conn: TConn): Record<string, unknown>;
  registerModelFactories?(factories: ModelFactory<TConn>[]): void;
}
```

`connect` is called once per tenant; result is cached. `getModels` is called on every request (must be cheap — no I/O).

### 5 — Migration orchestrator

`@kosan/cli` reads `kosan.config.ts` (loaded via `jiti` for TypeScript support), collects active tenants from the master DB, and runs Umzug migrations against each using bounded parallel execution (`withConcurrency`).

Migration files must export `up(qi)` and `down(qi)`. File loading (`loadMigrationsFromDir`) uses `pathToFileURL` for Windows-safe dynamic import.

The runner and file loader are intentionally decoupled: tests inject migration objects directly without touching the filesystem.

---

## Package-by-package API

### @kosan/core

```ts
// Setup
const registry = await TenantRegistry.create({ master, adapter, cache?, cipher?, hooks? });

// Tenant CRUD
await registry.createTenant({ slug, host, port, dbName, user, password, meta? });
await registry.updateTenant(id, { host?, password?, status?, meta? });
await registry.suspendTenant(id);
await registry.deleteTenant(id);
await registry.listTenants({ status?: 'active' | 'suspended' | 'deleted' });
await registry.getTenant(id);

// Resolution (called by middleware internally)
const ctx = await registry.resolveBySlug('acme');
const ctx = await registry.resolveById(id);

// Context
runWithTenant(ctx, async () => { ... });    // set
useTenant<TConn>()                          // read (throws outside context)
getCurrentTenant()                           // read (returns undefined outside context)
wrapWithTenantContext(ctx, done)            // for callback-based frameworks

// Resolvers
new SubdomainResolver({ ignoredSubdomains?: string[] })   // default: ['www']
new HeaderResolver('X-Tenant-ID')
new PathResolver({ segment: 0 })

// Observability
registry.getStats()                         // { cacheSize, cacheMaxSize, entries[] }
getTenantLogContext()                        // { tenantId, tenantSlug } | {}
getHealthPayload(registry)                  // serialisable cache snapshot

// Errors
TenantNotFoundError
TenantNotActiveError  (.status: 'suspended' | 'deleted')

// Types exported
TenantConfig, TenantStatus, CreateTenantInput, UpdateTenantInput,
MasterStore, Adapter, ModelFactory, Cipher, LifecycleHooks,
CacheOptions, TenantRegistryOptions, Resolver, TenantContextValue,
CacheStats, TenantLogContext, HealthPayload, SubdomainResolverOptions
```

### @kosan/sequelize

```ts
const masterStore = await SequelizeMasterStore.create(sequelize, syncOptions?);
const adapter = new SequelizeAdapter({
  defaultDialect?,    // 'postgres' | 'mysql' | 'mariadb' | 'sqlite' | 'mssql'
  pool?,              // { max, min, acquire, idle }
  dialectOptions?,
  logging?,
  onSlowQuery?,       // (info: SlowQueryInfo) => void
  slowQueryThresholdMs?,  // default: 1000
});

// Model factories
type SequelizeModelFactory = ({ sequelize }: AdapterContext) => unknown;
registry.registerModels([OrderModel, UserModel]);

// Types exported
SequelizeAdapterOptions, AdapterContext, SequelizeModelFactory, SlowQueryInfo
```

### @kosan/prisma

```ts
const masterStore = new PrismaMasterStore(masterPrisma.tenant);
const adapter = new PrismaAdapter({
  PrismaClient,            // the generated PrismaClient constructor
  buildUrl: (tenant) => string,
  datasourceName?: 'db',  // must match your schema.prisma datasource name
});

usePrisma<PrismaClient>() // shortcut for useTenant().models['prisma']

// Exports
TENANT_PRISMA_SCHEMA      // Prisma model block as a string
PrismaClientLike, PrismaClientConstructor, TenantDelegate, PrismaAdapterOptions, PrismaModels
```

### @kosan/express

```ts
app.use(tenantMiddleware({
  registry,
  resolver,                // Resolver | (req) => string | null
  onMissingTenant?,        // (req, res) => void  — default: 400
}));
// 404 on TenantNotFoundError, 403 on TenantNotActiveError, 500 on unexpected
```

### @kosan/fastify

```ts
await fastify.register(tenantPlugin, {
  registry,
  resolver,
  onMissingTenant?,        // async (req, reply) => void  — default: 400
});
// fp(fastify-plugin) wraps it so hooks apply globally
```

### @kosan/koa

```ts
app.use(tenantMiddleware({
  registry,
  resolver,
  onMissingTenant?,        // (ctx) => void  — default: 400
}));
```

### @kosan/drizzle

```ts
// Adapter — creates one Drizzle client per tenant
const adapter = new DrizzleAdapter({
  clientFactory: (tenant) => drizzle(postgres(`postgres://${tenant.user}:...`)),
});

// MasterStore — query callbacks using your own Drizzle client
const masterStore = new DrizzleMasterStore({
  findAll: (filter?) => ...,
  findBySlug: (slug) => ...,
  findById: (id) => ...,
  create: (data) => ...,
  update: (id, data) => ...,
  delete: (id) => ...,
});

// Context shortcut
useDrizzle<TClient>()   // returns models.drizzle, typed

// Schema snippets (copy-paste)
TENANT_DRIZZLE_SCHEMA_PG
TENANT_DRIZZLE_SCHEMA_SQLITE
TENANT_DRIZZLE_SCHEMA_MYSQL
```

### @kosan/nestjs

```ts
// app.module.ts
@Module({
  imports: [
    KosanModule.forRoot({ resolver, master, adapter, missingTenantStatus? }),
    // or:
    KosanModule.forRootAsync({ imports, inject, useFactory }),
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

// In a controller
@Controller('orders')
export class OrdersController {
  @Get()
  list(@CurrentTenant() ctx: TenantContextValue) { ... }
}

// Inject registry
constructor(@InjectRegistry() private registry: TenantRegistry) {}

// Optional guard (checks context was set, does not resolve)
@UseGuards(TenantGuard)
```

### @kosan/cli

```ts
// kosan.config.ts
import type { KosanConfig } from '@kosan/cli';
export default {
  master: 'postgres://...',  // or SequelizeOptions object
  migrationsPath: './migrations',
  migrationsTableName?: 'sequelize_meta',
  concurrency?: 5,
} satisfies KosanConfig;
```

```bash
npx kosan migrate --config kosan.config.ts --concurrency 4 --tenant acme
```

Migration file shape:
```ts
export async function up(qi: QueryInterface): Promise<void> { ... }
export async function down(qi: QueryInterface): Promise<void> { ... }
```

---

## Development workflow

```bash
# Install all dependencies
pnpm install

# Run all tests
pnpm test

# Run tests for a single package
pnpm --filter @kosan/core test

# Build all packages (produces dist/ in each)
pnpm build

# Lint (Biome)
pnpm lint

# Format
pnpm format

# Type-check all packages
pnpm typecheck

# Docs dev server
cd docs && pnpm start
```

### Adding a new package

1. Create `packages/<name>/` with `src/index.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `tsup.config.ts`
2. Add `@kosan/core` to `dependencies` in its `package.json`
3. Add vitest alias: `'@kosan/core': path.resolve('../core/src/index.ts')`
4. Add to `pnpm-workspace.yaml` (already covered by `packages/*`)
5. Write a page in `docs/docs/packages/<name>.md`

---

## Build system details

Each package uses **tsup** configured in `tsup.config.ts`:

```ts
// packages/<name>/tsup.config.ts
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  clean: true,
  shims: true,
});
```

The CLI package has two entries: `src/index.ts` (library API) and `src/cli.ts` (the binary).

Output per package:
```
dist/
  index.js       — ESM
  index.cjs      — CommonJS
  index.d.ts     — Type declarations
  index.d.cts    — CJS type declarations
```

The `package.json` `exports` field routes consumers to the correct format automatically.

---

## Testing architecture

- **Framework**: Vitest, `vitest run` (no watch in CI)
- **No built packages needed**: every `vitest.config.ts` aliases `@kosan/core` and `@kosan/sequelize` to their TypeScript source (`../core/src/index.ts`), so tests run directly against source without a build step
- **SQLite in-memory**: Sequelize and CLI tests use `dialect: 'sqlite', storage: ':memory:'` — no Postgres required for tests
- **Isolated fakes**: `InMemoryMasterStore` and `FakeAdapter` in `packages/core/tests/helpers/` are used by all packages that need a registry

Test counts: 168 across 14 test files across 7 packages.

---

## Publishing checklist

### One-time setup

- [ ] Create npm organisation `@kosan` at npmjs.com
- [ ] `npm login` (or `pnpm login`) with a token that has publish rights
- [ ] Confirm the GitHub repo URL matches the `repository` field in all `package.json` files (currently set to `https://github.com/kosan-dev/kosan.git` — update if different)

### Before first publish

```bash
# 1. Build everything
pnpm build

# 2. Run tests
pnpm test

# 3. Dry-run publish for one package to check what gets included
cd packages/core
npm publish --dry-run --access public
# Review the file list — should only contain dist/ and LICENSE

# 4. Publish all packages (in dependency order — @kosan/core must go first)
pnpm --filter @kosan/core publish --access public --no-git-checks
pnpm --filter @kosan/sequelize publish --access public --no-git-checks
pnpm --filter @kosan/prisma publish --access public --no-git-checks
pnpm --filter @kosan/drizzle publish --access public --no-git-checks
pnpm --filter @kosan/express publish --access public --no-git-checks
pnpm --filter @kosan/fastify publish --access public --no-git-checks
pnpm --filter @kosan/koa publish --access public --no-git-checks
pnpm --filter @kosan/nestjs publish --access public --no-git-checks
pnpm --filter @kosan/cli publish --access public --no-git-checks
```

### Version management (future)

Consider adding [Changesets](https://github.com/changesets/changesets) for coordinated multi-package versioning:

```bash
pnpm add -D -w @changesets/cli
pnpm changeset init
# On each change: pnpm changeset
# On release: pnpm changeset version && pnpm changeset publish
```

---

## What's already in place for publishing

| Item | Status |
|---|---|
| `"files": ["dist", "LICENSE"]` in all packages | ✅ |
| `"publishConfig": { "access": "public" }` | ✅ |
| `"license": "MIT"` + `LICENSE` file at root | ✅ |
| `"engines": { "node": ">=18" }` | ✅ |
| `"exports"` field with ESM + CJS + types | ✅ |
| `"prepublishOnly": "pnpm build"` | ✅ |
| `description`, `keywords`, `author`, `repository`, `bugs`, `homepage` | ✅ |
| `tsup.config.ts` in every package | ✅ |
| Peer dependencies declared on framework packages | ✅ |
| CLI `bin` field pointing to `dist/cli.js` | ✅ |
| GitHub Actions CI (test × Node 18/20/22, build, lint) | ✅ |

---

## Known caveats and non-obvious decisions

### SubdomainResolver requires 3-part hostnames
`acme.myapp.com` resolves, `acme.localhost` does **not** (only 2 parts). In local dev, use `acme.myapp.localhost` or pass requests through a reverse proxy that adds a fake TLD.

### Fastify context propagation uses callbacks, not async
Fastify's lifecycle hook model means `storage.run()` must be called synchronously with `done` as the callback — this is why `wrapWithTenantContext(ctx, done)` exists. Using `async onRequest` with `enterWith` causes context leaks and doesn't propagate to route handlers. This is tested and working correctly.

### CLI uses jiti for TypeScript config loading
`kosan.config.ts` is loaded via `jiti` (a lightweight TypeScript runner). This means the config file is **not** transpiled by tsup — it's executed at runtime. Avoid complex TypeScript features in the config (they work, but error messages from jiti are less friendly).

### Dynamic imports in CLI are Windows-safe via `pathToFileURL`
`loadMigrationsFromDir` uses `pathToFileURL(filePath).href` before `await import(...)`. Raw Windows paths (`C:\...`) fail inside `import()`. This is already handled.

### Prisma adapter has no hard `@prisma/client` dependency
`@kosan/prisma` uses structural typing — `PrismaClientLike`, `PrismaClientConstructor<T>` — so you can use any Prisma client version or a fake in tests without installing `@prisma/client` as a hard dep. It is listed as an optional peer dependency.

### `@kosan/core` is in `dependencies` (not `peerDependencies`) of adapter packages
This is intentional for the 0.1.0 release. When published, pnpm replaces `workspace:*` with the actual version. Users installing e.g. `@kosan/express` will automatically get `@kosan/core`. Revisit this if version conflicts become a problem (the fix is moving `@kosan/core` to `peerDependencies + devDependencies`).

### `KosanConfig.master` accepts string or SequelizeOptions
The CLI config accepts either a connection string or a full `Sequelize` options object. The runner uses `new Sequelize(connectionString)` or `new Sequelize(options)` accordingly.

---

## Docs site

Built with VitePress 1. Lives in `docs/`.

```bash
cd docs
pnpm install
pnpm dev      # dev server at localhost:5173
pnpm build    # static output in docs/.vitepress/dist/
pnpm preview  # serve the built output
```

Config: `docs/.vitepress/config.mts`. Sidebar order: Introduction → Getting Started → Packages → Guides → Deployment.

Content lives in `docs/docs/`. Add a new guide by creating a `.md` file and adding it to the `sidebar` array in `config.mts`.

---

## Milestone history

| Milestone | Status | What shipped |
|---|---|---|
| 1 — Core + Sequelize + Express + Demo | ✅ | `@kosan/core`, `@kosan/sequelize`, `@kosan/express`, Docker Compose example |
| 2 — CLI | ✅ | `@kosan/cli` with `kosan migrate`, concurrency, failure isolation |
| 3 — Prisma | ✅ | `@kosan/prisma` with structural typing, no hard client dep |
| 4 — Fastify + Koa | ✅ | `@kosan/fastify` (callback hook), `@kosan/koa`, `wrapWithTenantContext` |
| 5 — Observability | ✅ | `getStats()`, `getHealthPayload()`, `getTenantLogContext()`, slow-query detection |
| 6 — Docs | ✅ | VitePress site with 17 pages across all packages and guides |
| 7 — NestJS | ✅ | `@kosan/nestjs` (module, guard, decorators) + `examples/sequelize-nestjs` demo |

**Planned (not started):**
- `@kosan/drizzle` — Drizzle ORM adapter
