---
"@kosan/core": minor
---

Stabilization fixes and features:

- **Breaking:** `useTenant().tenant` / `getCurrentTenant()` no longer include the database password (new `TenantInfo` type).
- New `onProvision(tenant)` hook runs before any connection is opened; `createTenant()` keeps the tenant unresolvable until hooks succeed and rolls back the master row if any step fails.
- Tenant rows are cached in-process (`cache.tenantTtlMs`, default 30 s, `0` disables), so requests no longer query the master DB every time.
- Concurrent first requests for a tenant share one connection instead of leaking a pool per request; `maxSize` is enforced under concurrency.
- New `JwtResolver` (bring your own `verify`).
- `SubdomainResolver` resolves `<slug>.localhost`, ignores IP hosts, and is case-insensitive.
- Cached connections are replaced when a tenant's host, port, database, user, password or dialect changes, including changes made by another process (picked up within `tenantTtlMs`).
- New tenant status `provisioning` while `createTenant()` runs its hooks (left behind only if provisioning crashes); `onSuspend` / `onDelete` now receive decrypted credentials.
- New optional `Adapter.connectionKey(tenant)`; the default reconnect key is the whole row except status and timestamps.
- Connection cache reworked so concurrent requests, evictions and settings changes can no longer leak pools or hang; `shutdown()` waits for connections still opening; credentials are decrypted only when a connection is opened.
- Tenant-row cache no longer re-caches rows read before a concurrent update/suspend/delete; `deleteTenant()` removes the row before evicting.
