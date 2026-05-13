# Todo API — @kosan/sequelize + @kosan/express example

A multi-tenant Todo API with **Users** and **Todos** tables. Every tenant gets its own isolated Postgres database. The tenant is identified by the `X-Tenant` request header.

## What this demonstrates

| Feature | Where |
|---|---|
| Header-based tenant resolution | `src/server.ts` → `HeaderResolver('X-Tenant')` |
| Per-tenant Sequelize instance | `src/registry.ts` → `SequelizeAdapter` |
| Multiple model registration | `registry.registerModels([UserModel, TodoModel])` |
| Association via foreign key | `Todo.userId` → `User.id` with CASCADE delete |
| Nested resource routes | `GET /users/:userId/todos` |
| `useTenant()` in route handlers | `src/routes/users.ts`, `src/routes/todos.ts` |
| `onCreate` hook (schema sync) | `src/registry.ts` hooks |
| Observability | `GET /health` → `getHealthPayload()` |
| Tenant isolation proof | Same request to two tenants returns different data |

## Prerequisites

- Docker & Docker Compose
- Node.js ≥ 18
- pnpm

## Run

```bash
# 1 — start three Postgres containers (master + 2 tenant DBs)
docker-compose up -d

# 2 — install dependencies (from repo root)
pnpm install

# 3 — create the two tenant rows and sync their schemas
pnpm provision

# 4 — start the server
pnpm start
```

## API

All requests require the `X-Tenant: <slug>` header.

### Root

```bash
curl -H "X-Tenant: alpha" http://localhost:3000/
```

### Users

```bash
# List users
curl -H "X-Tenant: alpha" http://localhost:3000/users

# Create a user
curl -H "X-Tenant: alpha" -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@alpha.com"}'

# Get a user
curl -H "X-Tenant: alpha" http://localhost:3000/users/<user-id>

# Update a user
curl -H "X-Tenant: alpha" -X PATCH http://localhost:3000/users/<user-id> \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Smith"}'

# Delete a user (also deletes their todos)
curl -H "X-Tenant: alpha" -X DELETE http://localhost:3000/users/<user-id>
```

### Todos

```bash
# List todos for a user
curl -H "X-Tenant: alpha" http://localhost:3000/users/<user-id>/todos

# Create a todo
curl -H "X-Tenant: alpha" -X POST http://localhost:3000/users/<user-id>/todos \
  -H "Content-Type: application/json" \
  -d '{"title":"Buy milk"}'

# Mark as completed
curl -H "X-Tenant: alpha" -X PATCH http://localhost:3000/users/<user-id>/todos/<todo-id> \
  -H "Content-Type: application/json" \
  -d '{"completed":true}'

# Delete a todo
curl -H "X-Tenant: alpha" -X DELETE http://localhost:3000/users/<user-id>/todos/<todo-id>
```

### Isolation proof

```bash
# Create a user in alpha
ALPHA_USER=$(curl -s -H "X-Tenant: alpha" -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@alpha.com"}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Create a user in beta (separate database — no shared data)
BETA_USER=$(curl -s -H "X-Tenant: beta" -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@beta.com"}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Alpha sees only Alice
curl -H "X-Tenant: alpha" http://localhost:3000/users

# Beta sees only Bob
curl -H "X-Tenant: beta" http://localhost:3000/users
```

### Health

```bash
curl http://localhost:3000/health
# Shows cache stats (tenantId, idleMs per tenant) and the active log context
```

## Project structure

```
src/
├── models/
│   ├── User.ts       — Sequelize model factory (id, name, email)
│   └── Todo.ts       — Sequelize model factory (id, userId, title, completed)
├── routes/
│   ├── users.ts      — CRUD: GET/POST/PATCH/DELETE /users
│   └── todos.ts      — CRUD: GET/POST/PATCH/DELETE /users/:userId/todos
├── registry.ts       — TenantRegistry + SequelizeAdapter + model registration
├── provision.ts      — One-time tenant creation script
└── server.ts         — Express app + HeaderResolver middleware
docker-compose.yml    — master DB + alpha_db + beta_db
```

## Ports

| Service | Port |
|---|---|
| master DB | 5432 |
| alpha DB | 5433 |
| beta DB | 5434 |
| HTTP server | 3000 |

## Key pattern: `useTenant()` inside a route

```ts
import { useTenant } from '@kosan/core';

router.get('/', async (_req, res) => {
  const { models } = useTenant();          // ← no prop-drilling
  const User = models['User'] as ModelStatic<Model>;
  const users = await User.findAll();
  res.json(users);
});
```

`useTenant()` reads from `AsyncLocalStorage` — no request object needs to be passed through the call stack. The tenant context was set by `tenantMiddleware` before this handler ran.
