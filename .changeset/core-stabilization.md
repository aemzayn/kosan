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
