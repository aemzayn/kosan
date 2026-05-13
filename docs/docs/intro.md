---
---

# Introduction

Kosan is a **database-per-tenant multi-tenancy layer** for Node.js. It fills the gap that every major ORM leaves open: first-class support for opening one isolated connection pool per tenant, resolving which tenant owns a request, and propagating that context through your application without prop-drilling.

## The problem

Every production multi-tenant Node.js application ends up hand-rolling the same infrastructure:

- A connection manager that opens and caches one pool per tenant
- A resolver that maps an incoming HTTP request to a tenant identifier
- Request-scoped context propagation so models are reachable without threading state through every function call
- LRU eviction and idle-connection cleanup to keep memory bounded
- A migration runner that iterates all active tenants and applies schema changes

None of the major ORMs — Sequelize, Prisma, TypeORM, MikroORM, Drizzle — ship this out of the box.

## What Kosan provides

| Concern | Solution |
|---|---|
| One pool per tenant | `TenantRegistry` + `ConnectionCache` |
| Tenant resolution | `SubdomainResolver`, `HeaderResolver`, `PathResolver`, or a custom function |
| Request context | `AsyncLocalStorage` via `runWithTenant` / `useTenant` |
| LRU eviction + idle timeout | `ConnectionCache` with configurable `maxSize` and `idleTimeoutMs` |
| Per-tenant migrations | `@kosan/cli` — parallel, failure-isolated |
| ORM integration | `@kosan/sequelize`, `@kosan/prisma` |
| Framework integration | `@kosan/express`, `@kosan/fastify`, `@kosan/koa` |
| Observability | Pool stats, slow-query hooks, structured log context |

## Architecture

```
                      HTTP Request
                           │
             ┌─────────────▼─────────────┐
             │   Framework middleware      │
             │  (Express / Fastify / Koa)  │
             └─────────────┬─────────────┘
                           │  slug = resolver.resolve(req)
             ┌─────────────▼─────────────┐
             │       TenantRegistry       │
             │  resolveBySlug(slug)       │
             └──────┬──────────┬─────────┘
                    │          │
        ┌───────────▼──┐  ┌───▼────────────┐
        │  MasterStore  │  │ ConnectionCache │
        │ (find tenant) │  │ (LRU pool)     │
        └───────────────┘  └───────┬────────┘
                                   │  conn = adapter.connect(tenant)
                         ┌─────────▼──────────┐
                         │  ORM Adapter        │
                         │  (Sequelize/Prisma) │
                         └────────────────────┘
                                   │
               AsyncLocalStorage: { tenant, connection, models }
                                   │
             ┌─────────────────────▼──────────────────────┐
             │           Route handler / service            │
             │   const { models } = useTenant()            │
             └─────────────────────────────────────────────┘
```

## Package overview

| Package | Install |
|---|---|
| [`@kosan/core`](./packages/core) | `npm i @kosan/core` |
| [`@kosan/sequelize`](./packages/sequelize) | `npm i @kosan/sequelize` |
| [`@kosan/prisma`](./packages/prisma) | `npm i @kosan/prisma` |
| [`@kosan/express`](./packages/express) | `npm i @kosan/express` |
| [`@kosan/fastify`](./packages/fastify) | `npm i @kosan/fastify` |
| [`@kosan/koa`](./packages/koa) | `npm i @kosan/koa` |
| [`@kosan/cli`](./packages/cli) | `npm i -D @kosan/cli` |

## Requirements

- Node.js ≥ 18 (stable `AsyncLocalStorage`)
- TypeScript ≥ 5 with `strict: true`
