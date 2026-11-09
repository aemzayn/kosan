---
---

# Multi-region

Source: [`examples/multi-region`](https://github.com/aemzayn/kosan/tree/main/examples/multi-region)

One Express app serves tenants whose databases live on different Postgres servers, one per region. Each tenant row stores the host and port of its own server, so a single `SequelizeAdapter` connects everywhere, and handler code is identical for every region.

## What it shows

- **Per-region provisioning:** `onProvision` creates the tenant's database and a dedicated login role on its region's server, before Kosan connects.
- **Encrypted credentials:** every tenant gets its own random password, stored AES-256-GCM encrypted in the master table.
- **Live region moves:** `pnpm move-tenant globex eu` suspends the tenant, copies its data to the other region, repoints the row with `registry.updateTenant`, and drops the old database. The running server switches by itself within `cache.tenantTtlMs`: it re-reads the row, sees the new host, closes the old connection and reconnects.

## Run it

```bash
pnpm install && pnpm build          # from the repo root
cd examples/multi-region
docker compose up -d --wait         # master :5450, region-eu :5451, region-us :5452
pnpm provision
pnpm start

curl http://acme.localhost:3000/    # → region eu, localhost:5451/tenant_acme
curl http://globex.localhost:3000/  # → region us, localhost:5452/tenant_globex
pnpm move-tenant globex eu          # in another terminal, while the server runs
```

During a move, `globex` returns `200` from the old region, `403` while its data is being copied, then `200` from the new region, with no restart.

## The key pieces

```ts
// registry.ts
export const registry = await TenantRegistry.create({
  master: masterStore,
  adapter: new SequelizeAdapter({ defaultDialect: 'postgres' }),
  cipher,
  cache: { tenantTtlMs: 2_000 },
  hooks: {
    onProvision: (tenant) => createTenantDatabase(regionOf(tenant), tenant),
    onCreate: async (_tenant, sequelize) => { await sequelize.sync(); },
    onDelete: (tenant) => dropTenantDatabase(regionOf(tenant), tenant),
  },
});
```

```ts
// move-tenant.ts (simplified)
await registry.suspendTenant(tenant.id);
await createTenantDatabase(target, spec);
await copyData(oldHost, newHost);
await registry.updateTenant(tenant.id, {
  host: REGIONS[target].host,
  port: REGIONS[target].port,
  meta: { ...tenant.meta, region: target },
  status: 'active',
});
await dropTenantDatabase(oldRegion, spec);
```
