import { TenantRegistry } from '@huni/core';
import { SequelizeAdapter, SequelizeMasterStore } from '@huni/sequelize';
import { Sequelize } from 'sequelize';
import { OrderModel } from './models/order.js';

const master = new Sequelize({
  dialect: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'master',
  username: 'admin',
  password: 'admin',
  logging: false,
});

const masterStore = await SequelizeMasterStore.create(master);

const adapter = new SequelizeAdapter({
  defaultDialect: 'postgres',
  pool: { max: 5, idle: 30_000 },
  logging: false,
});

export const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  hooks: {
    async onCreate(tenant, conn) {
      // Sync all models for the new tenant's database.
      await conn.sync({ force: false });
      console.log(`[huni] provisioned tenant: ${tenant.slug}`);
    },
  },
});

registry.registerModels([OrderModel]);
