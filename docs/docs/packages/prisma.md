---
sidebar_position: 3
---

# @huni/prisma

Prisma adapter for Huni. Creates one `PrismaClient` per tenant with a per-tenant datasource URL, and provides `PrismaMasterStore` for the master tenant table.

```bash
npm install @huni/prisma
```

No hard dependency on `@prisma/client` — the adapter is fully generic and uses structural typing. Your generated client is a peer dependency.

---

## Setup

### 1 — Add the tenant model to your Prisma schema

```prisma title="prisma/schema.prisma"
model Tenant {
  id        String   @id @default(uuid())
  slug      String   @unique
  host      String
  port      Int
  dbName    String
  user      String
  password  String
  status    String   @default("active")
  meta      Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Or copy the convenience export:

```ts
import { TENANT_PRISMA_SCHEMA } from '@huni/prisma';
console.log(TENANT_PRISMA_SCHEMA); // prints the Prisma model block
```

### 2 — Create the adapter and master store

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaAdapter, PrismaMasterStore } from '@huni/prisma';
import { TenantRegistry } from '@huni/core';

// Master database client
const masterPrisma = new PrismaClient();

const masterStore = new PrismaMasterStore(masterPrisma.tenant);

const adapter = new PrismaAdapter({
  PrismaClient,                        // constructor for the generated client
  buildUrl: (tenant) =>
    `postgresql://${tenant.user}:${tenant.password}@${tenant.host}:${tenant.port}/${tenant.dbName}`,
  datasourceName: 'db',                // matches `datasource db { }` in schema.prisma
});

export const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
});
```

---

## PrismaAdapter

### Options

```ts
interface PrismaAdapterOptions<TClient> {
  PrismaClient: PrismaClientConstructor<TClient>;
  buildUrl: (tenant: TenantConfig) => string;
  datasourceName?: string; // default: 'db'
}
```

`buildUrl` receives the decrypted `TenantConfig` and must return a full connection string. This is where you can inject dynamic credentials, proxy URLs, or PgBouncer addresses:

```ts
buildUrl: (tenant) => {
  const base = `postgresql://${tenant.user}:${tenant.password}@`;
  if (tenant.meta?.['region'] === 'eu') {
    return `${base}eu-proxy.internal:6432/${tenant.dbName}`;
  }
  return `${base}${tenant.host}:${tenant.port}/${tenant.dbName}`;
},
```

---

## PrismaMasterStore

Pass `prisma.tenant` (the generated delegate) to the constructor. The store uses structural typing — as long as your `Tenant` model has the expected fields, it works:

```ts
import { PrismaMasterStore } from '@huni/prisma';

const masterStore = new PrismaMasterStore(masterPrisma.tenant);
```

---

## Accessing the Prisma client in handlers

Use the `usePrisma<TClient>()` shortcut instead of casting `models` manually:

```ts
import { usePrisma } from '@huni/prisma';
import type { PrismaClient } from '@prisma/client';

app.get('/users', async (_req, res) => {
  const prisma = usePrisma<PrismaClient>();
  const users = await prisma.user.findMany();
  res.json(users);
});
```

Under the hood this reads `useTenant().models['prisma']` with a type-safe cast.

---

## TENANT_PRISMA_SCHEMA

A convenience string with the ready-to-paste Prisma schema block:

```ts
import { TENANT_PRISMA_SCHEMA } from '@huni/prisma';
// Paste into your schema.prisma or print for reference
```

---

## Multiple schemas per tenant

If each tenant has their own Prisma schema (uncommon but valid), generate multiple clients and switch the `PrismaClient` constructor per tenant using `meta`:

```ts
import { PrismaClientV1 } from '../generated/v1/index.js';
import { PrismaClientV2 } from '../generated/v2/index.js';

const adapter = new PrismaAdapter({
  PrismaClient: PrismaClientV2, // default
  buildUrl: (tenant) => {
    const client = tenant.meta?.['schemaVersion'] === 'v1'
      ? PrismaClientV1
      : PrismaClientV2;
    // For per-tenant constructor switching, write a custom Adapter instead.
    return `postgresql://${tenant.user}:${tenant.password}@${tenant.host}/${tenant.dbName}`;
  },
});
```

For complex per-tenant schema versioning, implement a custom `Adapter<PrismaClient>` (see [Writing an adapter](../guides/writing-an-adapter)).

---

## Testing without the generated client

Use a structural fake that satisfies `PrismaClientLike`:

```ts
import type { PrismaClientLike } from '@huni/prisma';

class FakePrismaClient implements PrismaClientLike {
  async $connect() {}
  async $disconnect() {}
  user = {
    findMany: async () => [{ id: '1', email: 'test@example.com' }],
  };
}
```
