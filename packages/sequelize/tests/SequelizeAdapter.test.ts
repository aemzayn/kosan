import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sequelize, DataTypes } from 'sequelize';
import { SequelizeAdapter } from '../src/SequelizeAdapter.js';
import type { TenantConfig } from '@kosan/core';
import type { AdapterContext } from '../src/types.js';

function makeTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    id: 'tenant-1',
    slug: 'acme',
    host: '',
    port: 0,
    dbName: ':memory:',
    user: '',
    password: '',
    status: 'active',
    meta: { dialect: 'sqlite' },
    ...overrides,
  };
}

describe('SequelizeAdapter', () => {
  let adapter: SequelizeAdapter;
  const openConnections: Sequelize[] = [];

  beforeEach(() => {
    adapter = new SequelizeAdapter({ defaultDialect: 'sqlite', logging: false });
  });

  afterEach(async () => {
    for (const conn of openConnections) {
      try {
        await conn.close();
      } catch {
        // already closed
      }
    }
    openConnections.length = 0;
  });

  // -------------------------------------------------------------------------
  // connect / disconnect
  // -------------------------------------------------------------------------

  describe('connect', () => {
    it('returns an authenticated Sequelize instance', async () => {
      const tenant = makeTenant();
      const sequelize = await adapter.connect(tenant);
      openConnections.push(sequelize);
      expect(sequelize).toBeInstanceOf(Sequelize);
      // authenticate() succeeded — if it throws we would not reach this line
    });

    it('creates separate instances per tenant', async () => {
      const t1 = makeTenant({ id: 't1', slug: 'a' });
      const t2 = makeTenant({ id: 't2', slug: 'b' });
      const s1 = await adapter.connect(t1);
      const s2 = await adapter.connect(t2);
      openConnections.push(s1, s2);
      expect(s1).not.toBe(s2);
    });
  });

  describe('disconnect', () => {
    it('closes the Sequelize connection', async () => {
      const tenant = makeTenant();
      const sequelize = await adapter.connect(tenant);
      await adapter.disconnect(sequelize);
      // A closed connection should throw on any further query.
      await expect(sequelize.authenticate()).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // registerModelFactories / getModels
  // -------------------------------------------------------------------------

  describe('registerModelFactories', () => {
    it('applies factories and exposes models via getModels', async () => {
      function NoteModel({ sequelize }: AdapterContext) {
        return sequelize.define('Note', {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          body: { type: DataTypes.TEXT },
        });
      }

      adapter.registerModelFactories([NoteModel]);

      const tenant = makeTenant();
      const sequelize = await adapter.connect(tenant);
      openConnections.push(sequelize);

      const models = adapter.getModels(sequelize);
      expect(models['Note']).toBeDefined();
    });

    it('applies multiple factories independently per connection', async () => {
      function ModelA({ sequelize }: AdapterContext) {
        return sequelize.define('ModelA', { id: { type: DataTypes.INTEGER, primaryKey: true } });
      }
      function ModelB({ sequelize }: AdapterContext) {
        return sequelize.define('ModelB', { id: { type: DataTypes.INTEGER, primaryKey: true } });
      }

      adapter.registerModelFactories([ModelA, ModelB]);

      const s1 = await adapter.connect(makeTenant({ id: 't1', slug: 'a' }));
      const s2 = await adapter.connect(makeTenant({ id: 't2', slug: 'b' }));
      openConnections.push(s1, s2);

      // Each Sequelize instance has its own model registry — they don't bleed.
      expect(adapter.getModels(s1)['ModelA']).toBeDefined();
      expect(adapter.getModels(s2)['ModelA']).toBeDefined();
      // The two model instances should be different objects.
      expect(adapter.getModels(s1)['ModelA']).not.toBe(adapter.getModels(s2)['ModelA']);
    });
  });

  // -------------------------------------------------------------------------
  // Integration with TenantRegistry
  // -------------------------------------------------------------------------

  describe('integration with TenantRegistry', () => {
    it('round-trips through registry resolve → useTenant models', async () => {
      const { TenantRegistry, runWithTenant } = await import('@kosan/core');
      const { InMemoryMasterStore } = await import(
        '../../core/tests/helpers/InMemoryMasterStore.js'
      );

      function ItemModel({ sequelize }: AdapterContext) {
        return sequelize.define('Item', {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING },
        });
      }

      adapter.registerModelFactories([ItemModel]);

      const master = new InMemoryMasterStore();
      const registry = await TenantRegistry.create({ master, adapter });
      await registry.createTenant({
        slug: 'acme',
        host: '',
        port: 0,
        dbName: ':memory:',
        user: '',
        password: '',
        meta: { dialect: 'sqlite' },
      });

      const ctx = await registry.resolveBySlug('acme');
      openConnections.push(ctx.connection as Sequelize);

      await runWithTenant(ctx, async () => {
        const { useTenant } = await import('@kosan/core');
        const { models } = useTenant<Sequelize>();
        expect(models['Item']).toBeDefined();
      });

      await registry.shutdown();
    });
  });
});
