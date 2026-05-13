/**
 * Standalone registry factory used by the provision script.
 * The NestJS app initialises its own registry via HuniModule.forRootAsync.
 */
import { TenantRegistry } from '@huni/core';
import { SequelizeMasterStore, SequelizeAdapter } from '@huni/sequelize';
import { Sequelize } from 'sequelize';
import { OrderModel } from './models/order';

export async function createRegistry(): Promise<TenantRegistry> {
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

  const registry = await TenantRegistry.create({
    master: masterStore,
    adapter,
    hooks: {
      async onCreate(tenant, conn) {
        await conn.sync({ force: false });
        console.log(`[huni] provisioned schema for tenant: ${tenant.slug}`);
      },
    },
  });

  registry.registerModels([OrderModel]);
  return registry;
}
