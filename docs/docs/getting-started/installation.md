---
---

# Installation

## Prerequisites

- Node.js ≥ 18
- TypeScript ≥ 5 (`strict: true` recommended)
- A package manager: npm, pnpm, or yarn

## Choose your stack

Install `@kosan/core` plus the packages that match your ORM and framework.

### Sequelize + Express

```bash
npm install @kosan/core @kosan/sequelize @kosan/express
```

### Sequelize + Fastify

```bash
npm install @kosan/core @kosan/sequelize @kosan/fastify fastify-plugin
```

### Sequelize + Koa

```bash
npm install @kosan/core @kosan/sequelize @kosan/koa
```

### Prisma + Express

```bash
npm install @kosan/core @kosan/prisma @kosan/express
```

### Prisma + Fastify

```bash
npm install @kosan/core @kosan/prisma @kosan/fastify fastify-plugin
```

### Migration CLI (dev dependency)

```bash
npm install -D @kosan/cli
```

## TypeScript configuration

Kosan is ESM-first. Make sure your `tsconfig.json` targets a modern module system:

```json [tsconfig.json]
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true
  }
}
```

If you use CommonJS (`"module": "CommonJS"`), Kosan ships a CJS build and will work, but the ESM build is preferred.

## Peer dependencies

| Package | Peer dep |
|---|---|
| `@kosan/sequelize` | `sequelize ^6` |
| `@kosan/prisma` | `@prisma/client ^5` (generated client only) |
| `@kosan/express` | `express ^4 \|\| ^5` |
| `@kosan/fastify` | `fastify ^4 \|\| ^5`, `fastify-plugin ^4` |
| `@kosan/koa` | `koa ^2` |
| `@kosan/cli` | `sequelize ^6` (for migration storage) |
