---
"@kosan/sequelize": minor
"@kosan/prisma": minor
"@kosan/drizzle": minor
---

The tenant `status` column accepts the new `provisioning` value, and `SequelizeAdapter` implements `connectionKey()` so unrelated `meta` changes don't reopen a tenant's pool.

**Existing master databases need a one-time migration** before upgrading:

- Postgres + `SequelizeMasterStore`: `ALTER TYPE "enum_tenants_status" ADD VALUE 'provisioning';`
- MySQL + `SequelizeMasterStore`: `ALTER TABLE tenants MODIFY status ENUM('active','suspended','deleted','provisioning') NOT NULL DEFAULT 'active';`
- Prisma: add `provisioning` to `enum TenantStatus` and run `prisma migrate dev`.
- Drizzle: `text(..., { enum })` columns need no DB change; update the enum list in your schema.
