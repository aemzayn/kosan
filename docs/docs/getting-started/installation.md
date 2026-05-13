---
---

# Installation

## Prerequisites

- Node.js ≥ 18
- TypeScript ≥ 5 (`strict: true` recommended)
- A package manager: npm, pnpm, or yarn

## Choose your stack

Install `@huni/core` plus the packages that match your ORM and framework.

### Sequelize + Express

```bash
npm install @huni/core @huni/sequelize @huni/express
```

### Sequelize + Fastify

```bash
npm install @huni/core @huni/sequelize @huni/fastify fastify-plugin
```

### Sequelize + Koa

```bash
npm install @huni/core @huni/sequelize @huni/koa
```

### Prisma + Express

```bash
npm install @huni/core @huni/prisma @huni/express
```

### Prisma + Fastify

```bash
npm install @huni/core @huni/prisma @huni/fastify fastify-plugin
```

### Migration CLI (dev dependency)

```bash
npm install -D @huni/cli
```

## TypeScript configuration

Huni is ESM-first. Make sure your `tsconfig.json` targets a modern module system:

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

If you use CommonJS (`"module": "CommonJS"`), Huni ships a CJS build and will work, but the ESM build is preferred.

## Peer dependencies

| Package | Peer dep |
|---|---|
| `@huni/sequelize` | `sequelize ^6` |
| `@huni/prisma` | `@prisma/client ^5` (generated client only) |
| `@huni/express` | `express ^4 \|\| ^5` |
| `@huni/fastify` | `fastify ^4 \|\| ^5`, `fastify-plugin ^4` |
| `@huni/koa` | `koa ^2` |
| `@huni/cli` | `sequelize ^6` (for migration storage) |
