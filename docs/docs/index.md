---
layout: home

hero:
  name: Huni
  tagline: First-class database-per-tenant multi-tenancy for Node.js
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: Introduction
      link: /intro
    - theme: alt
      text: GitHub
      link: https://github.com/huni-dev/huni

features:
  - title: One pool per tenant
    details: TenantRegistry + ConnectionCache manages isolated connection pools automatically. LRU eviction and idle-timeout keep memory bounded.
  - title: Zero prop-drilling
    details: AsyncLocalStorage propagates the current tenant's connection and models through your entire request stack. Call useTenant() anywhere.
  - title: Pluggable resolvers
    details: Resolve the tenant from a subdomain, HTTP header, URL path segment, JWT claim, or any custom function you provide.
  - title: ORM-agnostic core
    details: The core is ORM-agnostic. Official adapters for Sequelize, Prisma, and Drizzle. Bring your own by implementing the Adapter interface.
  - title: Framework middleware
    details: Thin middleware adapters for Express, Fastify, Koa, and NestJS. Wires resolution and context into your framework with two lines.
  - title: Migration orchestrator
    details: "@huni/cli iterates all active tenants and runs Umzug migrations against each in parallel, with failure isolation and concurrency control."
---
