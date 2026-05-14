import { TenantRegistry } from "@kosan/core";
import { PrismaAdapter, PrismaMasterStore } from "@kosan/prisma";
import { PrismaClient as MasterPrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Master database — holds the tenant registry
// ---------------------------------------------------------------------------

const masterPrisma = new MasterPrismaClient({
  datasources: {
    db: { url: "postgresql://admin:admin@localhost:5432/master" },
  },
});

const masterStore = new PrismaMasterStore(masterPrisma.tenant);

// ---------------------------------------------------------------------------
// Tenant adapter — one PrismaClient per tenant connection
//
// NOTE: TenantPrismaClient below refers to the generated client from
// prisma/tenant-schema.prisma. Run `pnpm db:generate` first.
// For simplicity this example reuses the same PrismaClient class and
// overrides the datasource URL per tenant.
// ---------------------------------------------------------------------------

const adapter = new PrismaAdapter({
  PrismaClient: MasterPrismaClient,
  buildUrl: (t) => `postgresql://${t.user}:${t.password}@${t.host}:${t.port}/${t.dbName}`,
});

export const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  hooks: {
    async onCreate(_tenant, prisma) {
      // Create the posts table in the new tenant's database.
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS posts (
          id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL,
          body  text NOT NULL
        )
      `);
    },
  },
});
