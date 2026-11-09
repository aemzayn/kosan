import { TenantRegistry } from "@kosan/core";
import { SequelizeAdapter, SequelizeMasterStore } from "@kosan/sequelize";
import { Sequelize } from "sequelize";
import { cipher } from "./cipher.js";
import { MASTER_DB, regionOf } from "./config.js";
import { OrderModel } from "./models/order.js";
import { createTenantDatabase, dropTenantDatabase } from "./provisioning.js";

const master = new Sequelize(MASTER_DB);
const masterStore = await SequelizeMasterStore.create(master);

export const registry = await TenantRegistry.create({
  master: masterStore,
  // One adapter serves every region: each tenant row carries its own host/port.
  adapter: new SequelizeAdapter({ defaultDialect: "postgres", pool: { max: 5 } }),
  // Tenant DB passwords are stored AES-256-GCM encrypted in the master table.
  cipher,
  cache: {
    maxSize: 50,
    // Short TTL so changes made by another process (e.g. `pnpm move-tenant`)
    // reach this server within ~2 s. Production would typically use 30 s+.
    tenantTtlMs: 2_000,
  },
  hooks: {
    // Runs before Kosan connects: create the database on the tenant's region.
    async onProvision(tenant) {
      await createTenantDatabase(regionOf(tenant), tenant);
    },
    // Runs with a connection to the new database: create the schema.
    async onCreate(_tenant, sequelize) {
      await sequelize.sync();
    },
    async onDelete(tenant) {
      await dropTenantDatabase(regionOf(tenant), tenant);
    },
  },
});

registry.registerModels([OrderModel]);

export async function closeRegistry(): Promise<void> {
  await registry.shutdown();
  await master.close();
}
