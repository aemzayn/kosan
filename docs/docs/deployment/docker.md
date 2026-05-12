---
sidebar_position: 1
---

# Docker Deployment

This guide shows how to deploy a Huni application with Docker Compose — a master Postgres database for tenant records and separate databases (or containers) for tenant data.

---

## Architecture

```
┌─────────────────────────────────────────┐
│  docker-compose.yml                      │
│                                          │
│  ┌────────────┐   ┌──────────────────┐  │
│  │  app       │   │  master-postgres  │  │
│  │  :3000     │──▶│  tenants table   │  │
│  └────────────┘   └──────────────────┘  │
│         │                               │
│         ▼                               │
│  ┌──────────────┐  ┌─────────────────┐  │
│  │ tenant-acme  │  │  tenant-globex  │  │
│  │  postgres    │  │  postgres       │  │
│  └──────────────┘  └─────────────────┘  │
└─────────────────────────────────────────┘
```

---

## Docker Compose

```yaml title="docker-compose.yml"
version: "3.9"

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      MASTER_DATABASE_URL: postgres://admin:admin@master-db:5432/master
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      NODE_ENV: production
    depends_on:
      master-db:
        condition: service_healthy
    restart: unless-stopped

  master-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: admin
      POSTGRES_DB: master
    volumes:
      - master-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U admin -d master"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Tenant databases — add one per tenant, or use a single Postgres with multiple databases
  tenant-acme:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: acme_user
      POSTGRES_PASSWORD: acme_pass
      POSTGRES_DB: acme_db
    volumes:
      - tenant-acme-data:/var/lib/postgresql/data

  tenant-globex:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: globex_user
      POSTGRES_PASSWORD: globex_pass
      POSTGRES_DB: globex_db
    volumes:
      - tenant-globex-data:/var/lib/postgresql/data

volumes:
  master-data:
  tenant-acme-data:
  tenant-globex-data:
```

---

## Dockerfile

```dockerfile title="Dockerfile"
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

---

## Environment variables

```bash title=".env"
# 32-byte hex key for credential encryption
ENCRYPTION_KEY=0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b

# Master database (where tenant records live)
MASTER_DATABASE_URL=postgres://admin:admin@master-db:5432/master
```

---

## Tenant provisioning script

Run this once after `docker compose up` to register tenants:

```ts title="scripts/provision.ts"
import { registry } from '../src/registry.js';

const tenants = [
  {
    slug: 'acme',
    host: 'tenant-acme',
    port: 5432,
    dbName: 'acme_db',
    user: 'acme_user',
    password: 'acme_pass',
  },
  {
    slug: 'globex',
    host: 'tenant-globex',
    port: 5432,
    dbName: 'globex_db',
    user: 'globex_user',
    password: 'globex_pass',
  },
];

for (const tenant of tenants) {
  const existing = await registry.listTenants().then((ts) =>
    ts.find((t) => t.slug === tenant.slug),
  );

  if (!existing) {
    await registry.createTenant(tenant);
    console.log(`Created tenant: ${tenant.slug}`);
  } else {
    console.log(`Tenant already exists: ${tenant.slug}`);
  }
}

await registry.shutdown();
```

```bash
# Run from inside the app container or with DB access
docker compose exec app node --import tsx scripts/provision.ts
```

---

## Running migrations in CI/CD

```yaml title=".github/workflows/deploy.yml"
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build and push Docker image
        run: |
          docker build -t myapp:${{ github.sha }} .
          docker push myapp:${{ github.sha }}

      - name: Run tenant migrations
        run: |
          docker run --rm \
            --network production \
            -e MASTER_DATABASE_URL=${{ secrets.MASTER_DATABASE_URL }} \
            -e ENCRYPTION_KEY=${{ secrets.ENCRYPTION_KEY }} \
            myapp:${{ github.sha }} \
            node -e "import('./dist/migrate.js')"
```

Or using the CLI:

```bash
docker run --rm \
  -e MASTER_DATABASE_URL=$MASTER_DATABASE_URL \
  myapp:latest \
  npx huni migrate --concurrency 5
```

---

## Single-Postgres multi-database setup

Instead of one container per tenant, you can use a single Postgres instance with multiple databases. This is simpler to operate and good for smaller deployments:

```yaml title="docker-compose.yml (simplified)"
services:
  app:
    build: .
    environment:
      MASTER_DATABASE_URL: postgres://admin:admin@db:5432/master

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: admin
      POSTGRES_DB: master
    volumes:
      - pgdata:/var/lib/postgresql/data
```

Create tenant databases using the `onCreate` hook:

```ts
hooks: {
  async onCreate(tenant) {
    // Run as a superuser on the shared Postgres instance
    await superuserPool.query(
      `CREATE DATABASE "${tenant.dbName}" OWNER "${tenant.user}"`
    );
  },
}
```

Tenant rows in the master DB all point to the same host/port but different `dbName` values.
