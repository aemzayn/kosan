# multi-region example

Tenants whose databases live on **different Postgres servers**, one per region, served by a single Kosan app. It also shows a tenant being **moved to another region while the server keeps running**.

```
                    ┌──────────────┐
  acme.localhost ──►│              │──► region-eu :5451   tenant_acme, tenant_initech
globex.localhost ──►│  Express +   │
                    │    Kosan     │──► region-us :5452   tenant_globex
                    └──────┬───────┘
                           └─────────► master    :5450   tenants table (registry)
```

Kosan has no built-in idea of a "region". Each tenant row stores the host and port of the server that holds its database, and the adapter connects there. The region name lives in `tenant.meta.region`, which this example uses for display and for choosing the admin connection that creates databases.

## What it demonstrates

| Feature | Where |
|---|---|
| One adapter connecting to tenants on different hosts | `src/registry.ts` |
| `onProvision`: creating a database and login role on the tenant's region server | `src/registry.ts`, `src/provisioning.ts` |
| Per-tenant credentials, stored AES-256-GCM encrypted | `src/cipher.ts` |
| Subdomain resolution: handler code is identical for every region | `src/server.ts` |
| Moving a tenant between regions with no restart | `src/move-tenant.ts` |
| `onDelete`: dropping the database and role | `src/registry.ts` |

## Run it

From the repo root, install and build the packages once:

```bash
pnpm install
pnpm build
```

Then, in `examples/multi-region`:

```bash
docker compose up -d --wait   # master + region-eu + region-us
pnpm provision                # acme (eu), globex (us), initech (eu); safe to re-run
pnpm start                    # http://localhost:3000
```

## Try it

```bash
curl http://acme.localhost:3000/
# {"tenant":"acme","region":"eu","regionLabel":"Europe (Frankfurt)","database":"localhost:5451/tenant_acme"}

curl http://globex.localhost:3000/
# {"tenant":"globex","region":"us",...,"database":"localhost:5452/tenant_globex"}

curl http://globex.localhost:3000/orders
curl -X POST http://globex.localhost:3000/orders \
  -H 'Content-Type: application/json' -d '{"product":"Hammock","total":42.5}'

curl http://localhost:3000/health   # which tenants hold an open connection
```

`*.localhost` resolves to 127.0.0.1 in curl and modern browsers. If your client doesn't support it, send the header yourself: `curl -H 'Host: acme.localhost' http://localhost:3000/`.

## Move a tenant to another region

With the server still running, in a second terminal:

```bash
pnpm move-tenant globex eu
```

1. **Suspend** `globex`. Requests get `403` while the data is copied, so no writes are lost.
2. **Create** `tenant_globex` and its role on the EU server.
3. **Copy** the data.
4. **Update** the tenant row to the EU host and reactivate it, with `registry.updateTenant`.
5. **Drop** the old database on the US server.

Polling `globex` during a move looks like this:

```
200  localhost:5452/tenant_globex   ← before
403  Tenant "globex" is not active  ← during the copy
200  localhost:5451/tenant_globex   ← after: same app, new region, same data
```

The server picks up the change by itself. The registry caches tenant rows for `cache.tenantTtlMs` (2 s here; production apps usually use 30 s or more). Once that expires, it re-reads the row, sees that the host changed, closes the old connection and connects to the new region. The script waits slightly longer than the TTL at each step, so the server never sees a half-finished move.

> This is a demo. A production move would also copy every table, verify row counts, and handle large datasets (for example with `pg_dump` or logical replication).

## Clean up

```bash
docker compose down -v
```
