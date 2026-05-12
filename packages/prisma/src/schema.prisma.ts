/**
 * Prisma schema snippet required by `PrismaMasterStore`.
 *
 * Add this to your `schema.prisma` file, then run `prisma migrate dev`.
 *
 * ```prisma
 * enum TenantStatus {
 *   active
 *   suspended
 *   deleted
 * }
 *
 * model Tenant {
 *   id        String       @id @default(uuid())
 *   slug      String       @unique @db.VarChar(100)
 *   host      String       @db.VarChar(255)
 *   port      Int
 *   dbName    String       @map("db_name") @db.VarChar(255)
 *   user      String       @db.VarChar(255)
 *   password  String       @db.Text
 *   status    TenantStatus @default(active)
 *   meta      Json?
 *   createdAt DateTime     @default(now()) @map("created_at")
 *   updatedAt DateTime     @updatedAt @map("updated_at")
 *
 *   @@map("tenants")
 * }
 * ```
 *
 * This module exports only the schema string for documentation purposes.
 */
export const TENANT_PRISMA_SCHEMA = `
enum TenantStatus {
  active
  suspended
  deleted
}

model Tenant {
  id        String       @id @default(uuid())
  slug      String       @unique @db.VarChar(100)
  host      String       @db.VarChar(255)
  port      Int
  dbName    String       @map("db_name") @db.VarChar(255)
  user      String       @db.VarChar(255)
  password  String       @db.Text
  status    TenantStatus @default(active)
  meta      Json?
  createdAt DateTime     @default(now()) @map("created_at")
  updatedAt DateTime     @updatedAt @map("updated_at")

  @@map("tenants")
}
`.trim();
