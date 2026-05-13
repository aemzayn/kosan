# Project: Kosan — a multi-tenant database layer for Node.js

## Context and motivation

I'm building a Node.js library that fills a real gap in the ecosystem: **first-class
multi-tenancy with database-per-tenant support**, the way Hibernate (Java) and
stancl/tenancy (Laravel/PHP) have. No major Node.js ORM has this built-in today —
TypeORM, Sequelize, Prisma, MikroORM, and Objection all require you to hand-roll
the connection manager, tenant resolver, request context propagation, eviction
strategy, and per-tenant migration orchestration.

## Scope decision (CRITICAL — confirm before coding)

There are three possible products:

1. **Standalone ORM** with multi-tenancy as headline feature
2. **Multi-tenancy layer on top of existing ORMs** (Sequelize first, then Prisma/TypeORM)
3. **ORM-agnostic connection manager + tenant registry** (no model layer)

I want to start with **option 2, targeting Sequelize v6 first**. Reason: fastest to
useful, leverages an existing user base, lets us learn the patterns before
generalizing. The architecture should leave a clean path to options 1 and 3
later — keep the core (registry, resolver, cache, context) ORM-agnostic, with
Sequelize as the first adapter.

Confirm this scope before writing any code. If you have strong reasons to suggest
a different scope, raise them now.

## Architectural requirements

The library must provide, out of the box:

1. **Master DB registry** — a `Tenant` table schema and helpers for CRUD on tenants
   (id, slug, host, port, dbName, user, password, status, custom metadata as JSON)
2. **Tenant resolution strategies** — pluggable resolvers for subdomain, HTTP
   header, JWT claim, and URL path; users can write custom ones
3. **Connection cache** — keyed by tenant id, with configurable max size and LRU
   eviction, plus idle-timeout sweeping
4. **Request context propagation** — via `AsyncLocalStorage` so users can reach
   the current tenant's models/connection from anywhere without prop-drilling
5. **Pluggable secret handling** — credentials in the master table can be
   encrypted; user supplies a decrypt function or KMS integration
6. **Migration orchestration** — CLI that iterates all active tenants and runs
   migrations against each, with parallelism control and failure isolation
7. **Tenant lifecycle hooks** — `onCreate`, `onDelete`, `onSuspend` — for
   provisioning the physical database, running initial migrations, etc.
8. **Health and observability** — connection pool stats per tenant, slow-query
   hooks, request-tenant correlation in logs
9. **Express/Fastify/Koa middleware** — small adapters that wire resolution +
   context into common frameworks

## What it must NOT do (anti-goals)

- Don't reimplement Sequelize. We're a layer, not a replacement.
- Don't lock users into a specific framework. Middleware adapters are thin.
- Don't make the master DB a hard dependency on Postgres — it should work with
  whatever Sequelize supports (Postgres, MySQL, SQLite for tests)
- Don't auto-provision databases without explicit opt-in. Production users will
  want fine control over DB creation.

## Technical decisions already made

- **Language**: TypeScript, strict mode, published with full type definitions
- **Target Node**: ≥ 18 (for stable `AsyncLocalStorage`)
- **Module format**: ESM-first, with CJS interop
- **Package manager**: pnpm, monorepo via workspaces
- **Test runner**: Vitest
- **Lint/format**: Biome (faster than ESLint + Prettier, single tool)
- **Docs**: VitePress
- **CI**: GitHub Actions, matrix over Node 18/20/22 and Postgres/MySQL

## Suggested monorepo structure

```
packages/
  core/              # ORM-agnostic: registry, resolver, cache, context, types
  sequelize/         # Sequelize v6 adapter
  express/           # Express middleware
  fastify/           # Fastify plugin
  cli/               # Migration orchestrator
examples/
  sequelize-express/ # End-to-end demo
  multi-region/      # Tenants on different DB hosts
docs/
```

## First milestone: working end-to-end demo

Build, in order:

1. `@[name]/core` — `TenantRegistry`, `ConnectionCache`, `TenantContext`,
   `Resolver` interface. Pure TypeScript, no Sequelize dependency. Full unit
   tests with an in-memory fake adapter.
2. `@[name]/sequelize` — `SequelizeAdapter` implementing the core adapter
   interface. Handles instance creation, model registration via factory pattern,
   pool config, graceful shutdown on eviction.
3. `@[name]/express` — middleware that resolves tenant and runs the rest of the
   request inside the context.
4. `examples/sequelize-express` — runnable demo with 3 tenants in Postgres
   (Docker Compose), shows subdomain resolution, model usage, tenant provisioning.

After milestone 1 works end-to-end, we'll design the CLI and Prisma adapter.

## How I want you to work

- **Ask before assuming.** If a design decision is ambiguous (e.g., how to handle
  credential encryption, whether to support read replicas), surface it before
  picking one.
- **Show me the public API before implementing.** Write the README's "Quick
  start" section first — what does the user's code look like? — and let me
  approve it before you build the internals.
- **Test as you go.** Every module ships with Vitest tests. Aim for behavioral
  tests over implementation tests.
- **Small commits with clear messages.** I want to read the history later.
- **No `any`. No `// @ts-ignore`.** If types fight you, raise it; don't paper over.

## First task

1. Confirm or push back on the scope (option 2, Sequelize-first).
2. Propose the public API surface for `@[name]/core` and `@[name]/sequelize` as
   it would appear in the Quick Start docs. Show the user-facing code for:
   registering tenants, resolving by subdomain in Express, reading models inside
   a request handler, provisioning a new tenant, running migrations across all
   tenants.
3. Once I approve the API, scaffold the monorepo and implement `@[name]/core`.

Don't start coding internals until I've approved the public API.