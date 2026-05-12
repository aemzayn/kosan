import { TenantRegistry } from '@huni/core';
import { SequelizeAdapter, SequelizeMasterStore } from '@huni/sequelize';
import { Sequelize } from 'sequelize';
import { UserModel } from './models/User.js';
import { TodoModel } from './models/Todo.js';

const master = new Sequelize({
  dialect: 'postgres',
  host: process.env['MASTER_HOST'] ?? 'localhost',
  port: Number(process.env['MASTER_PORT'] ?? 5432),
  database: process.env['MASTER_DB'] ?? 'master',
  username: process.env['MASTER_USER'] ?? 'admin',
  password: process.env['MASTER_PASS'] ?? 'admin',
  logging: false,
});

const masterStore = await SequelizeMasterStore.create(master);

const adapter = new SequelizeAdapter({
  defaultDialect: 'postgres',
  pool: { max: 5, min: 0, acquire: 30_000, idle: 10_000 },
  logging: false,
});

export const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  hooks: {
    async onCreate(tenant, conn) {
      // Sync schema for this tenant's isolated database on first provision.
      await conn.sync({ force: false });
      console.log(`[huni] provisioned tenant: ${tenant.slug}`);
    },
  },
});

// Register both models — they're applied to every tenant connection.
registry.registerModels([UserModel, TodoModel]);
