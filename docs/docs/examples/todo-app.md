---
sidebar_position: 2
---

# Todo App (Sequelize + Express)

A complete multi-tenant Todo API with **Users** and **Todos** tables. Every tenant gets its own isolated Postgres database. The tenant is identified by the `X-Tenant` request header.

**Source:** [`examples/todo-sequelize-express/`](https://github.com/huni-dev/huni/tree/main/examples/todo-sequelize-express)

---

## What it covers

| Feature | Where |
|---|---|
| Header-based tenant resolution | `server.ts` → `HeaderResolver('X-Tenant')` |
| Multiple models per tenant | `registry.ts` → `registerModels([UserModel, TodoModel])` |
| Foreign key between models | `Todo.userId → User.id` with `CASCADE` delete |
| Nested resource routes | `GET /users/:userId/todos` |
| `useTenant()` anywhere in the stack | `routes/users.ts`, `routes/todos.ts` |
| Schema sync on first provision | `onCreate` hook in `registry.ts` |
| Per-tenant cache + observability | `GET /health` → `getHealthPayload()` |

---

## Architecture

```
Request: GET /users  +  X-Tenant: alpha
          │
          ▼
    tenantMiddleware
          │  HeaderResolver reads "X-Tenant: alpha"
          │  TenantRegistry looks up slug="alpha"
          │  Opens (or returns cached) Sequelize connection to alpha_db
          │  runWithTenant(ctx, next)
          ▼
    GET /users handler
          │  useTenant() → { tenant, models: { User, Todo } }
          │  User.findAll()  →  queries alpha_db.users
          ▼
    Response: [...alice, ...]
```

Each tenant's `User` and `Todo` records live in a completely separate Postgres database. The `alpha` tenant can never see `beta`'s data.

---

## File structure

```
examples/todo-sequelize-express/
├── src/
│   ├── models/
│   │   ├── User.ts          — id, name, email
│   │   └── Todo.ts          — id, userId (FK), title, completed
│   ├── routes/
│   │   ├── users.ts         — GET/POST/PATCH/DELETE /users[/:id]
│   │   └── todos.ts         — GET/POST/PATCH/DELETE /users/:userId/todos[/:id]
│   ├── registry.ts          — TenantRegistry + SequelizeAdapter + model registration
│   ├── provision.ts         — One-time tenant creation
│   └── server.ts            — Express app + HeaderResolver middleware
├── docker-compose.yml       — master + alpha_db + beta_db
└── README.md
```

---

## Running it

```bash
# 1 — start Postgres containers
docker-compose up -d

# 2 — install dependencies (from repo root)
pnpm install

# 3 — create tenants and sync schemas
pnpm provision

# 4 — start the server
pnpm start
```

---

## Key code snippets

### Registry setup

```ts
// src/registry.ts
import { TenantRegistry } from '@huni/core';
import { SequelizeAdapter, SequelizeMasterStore } from '@huni/sequelize';
import { UserModel } from './models/User.js';
import { TodoModel } from './models/Todo.js';

const masterStore = await SequelizeMasterStore.create(master);

const adapter = new SequelizeAdapter({
  defaultDialect: 'postgres',
  pool: { max: 5, min: 0, acquire: 30_000, idle: 10_000 },
  logging: false,
});

export const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  hooks: {
    async onCreate(tenant, conn) {
      // Sync Users + Todos tables to the new tenant's database.
      await conn.sync({ force: false });
    },
  },
});

registry.registerModels([UserModel, TodoModel]);
```

### Middleware + routing

```ts
// src/server.ts
import { HeaderResolver } from '@huni/core';
import { tenantMiddleware } from '@huni/express';

app.use(
  tenantMiddleware({
    registry,
    resolver: new HeaderResolver('X-Tenant'),
    onMissingTenant: (_req, res) => {
      res.status(400).json({ error: 'Missing X-Tenant header.' });
    },
  }),
);

app.use('/users', usersRouter);
app.use('/users/:userId/todos', todosRouter);
```

### Accessing models in a route

```ts
// src/routes/todos.ts
import { useTenant } from '@huni/core';

router.post('/', async (req, res) => {
  const { models } = useTenant();
  const Todo = models['Todo'] as ModelStatic<Model>;

  const todo = await Todo.create({
    ...req.body,
    userId: req.params.userId,
  });

  res.status(201).json(todo);
});
```

No request object is passed to `useTenant()`. The tenant context travels through `AsyncLocalStorage` — the same async call chain that Express uses to dispatch handlers.

### User model with Sequelize

```ts
// src/models/User.ts
export function UserModel({ sequelize }: AdapterContext) {
  return sequelize.define('User', {
    id:    { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name:  { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  }, { tableName: 'users', underscored: true });
}
```

### Todo model with foreign key

```ts
// src/models/Todo.ts
export function TodoModel({ sequelize }: AdapterContext) {
  return sequelize.define('Todo', {
    id:        { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId:    { type: DataTypes.UUID, allowNull: false, field: 'user_id',
                 references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
    title:     { type: DataTypes.STRING(200), allowNull: false },
    completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { tableName: 'todos', underscored: true });
}
```

---

## Try it

```bash
# Create a user for tenant "alpha"
curl -s -H "X-Tenant: alpha" -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@alpha.com"}'
# → { "id": "uuid-...", "name": "Alice", ... }

# Save the user ID
USER_ID=<paste id here>

# Add a todo
curl -H "X-Tenant: alpha" -X POST http://localhost:3000/users/$USER_ID/todos \
  -H "Content-Type: application/json" \
  -d '{"title":"Buy milk"}'

# List todos
curl -H "X-Tenant: alpha" http://localhost:3000/users/$USER_ID/todos

# Mark completed
curl -H "X-Tenant: alpha" -X PATCH http://localhost:3000/users/$USER_ID/todos/<todo-id> \
  -H "Content-Type: application/json" \
  -d '{"completed":true}'

# Prove isolation — beta has no data
curl -H "X-Tenant: beta" http://localhost:3000/users
# → []
```

---

## Observability

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "cacheSize": 2,
  "cacheMaxSize": 100,
  "tenantCount": 2,
  "entries": [
    { "tenantId": "...", "tenantSlug": "alpha", "lastUsed": 1700000000000, "idleMs": 312 },
    { "tenantId": "...", "tenantSlug": "beta",  "lastUsed": 1700000001000, "idleMs": 100 }
  ]
}
```
