import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sequelize } from 'sequelize';
import { SequelizeMasterStore } from '../src/SequelizeMasterStore.js';
import type { CreateTenantInput } from '@huni/core';

const BASE: CreateTenantInput = {
  slug: 'acme',
  host: 'localhost',
  port: 5432,
  dbName: 'acme_db',
  user: 'acme_user',
  password: 'secret',
};

describe('SequelizeMasterStore', () => {
  let sequelize: Sequelize;
  let store: SequelizeMasterStore;

  beforeEach(async () => {
    sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
    store = await SequelizeMasterStore.create(sequelize);
  });

  afterEach(async () => {
    await sequelize.close();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('inserts a tenant and returns it with generated id', async () => {
      const tenant = await store.create(BASE);
      expect(tenant.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(tenant.slug).toBe('acme');
      expect(tenant.status).toBe('active');
    });

    it('stores custom status', async () => {
      const tenant = await store.create({ ...BASE, status: 'suspended' });
      expect(tenant.status).toBe('suspended');
    });

    it('stores meta JSON', async () => {
      const tenant = await store.create({ ...BASE, meta: { plan: 'pro' } });
      expect(tenant.meta?.['plan']).toBe('pro');
    });
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe('findAll', () => {
    it('returns all tenants without filter', async () => {
      await store.create(BASE);
      await store.create({ ...BASE, slug: 'globex' });
      expect(await store.findAll()).toHaveLength(2);
    });

    it('filters by status', async () => {
      const { id } = await store.create(BASE);
      await store.create({ ...BASE, slug: 'globex' });
      await store.update(id, { status: 'suspended' });

      const active = await store.findAll({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0]?.slug).toBe('globex');
    });
  });

  // -------------------------------------------------------------------------
  // findBySlug
  // -------------------------------------------------------------------------

  describe('findBySlug', () => {
    it('finds a tenant by slug', async () => {
      await store.create(BASE);
      const found = await store.findBySlug('acme');
      expect(found?.slug).toBe('acme');
    });

    it('returns null for an unknown slug', async () => {
      expect(await store.findBySlug('unknown')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('finds a tenant by id', async () => {
      const { id } = await store.create(BASE);
      const found = await store.findById(id);
      expect(found?.id).toBe(id);
    });

    it('returns null for an unknown id', async () => {
      expect(await store.findById('no-such-id')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('updates mutable fields', async () => {
      const { id } = await store.create(BASE);
      const updated = await store.update(id, { host: 'db2.example.com', port: 5433 });
      expect(updated.host).toBe('db2.example.com');
      expect(updated.port).toBe(5433);
    });

    it('changes status', async () => {
      const { id } = await store.create(BASE);
      const updated = await store.update(id, { status: 'suspended' });
      expect(updated.status).toBe('suspended');
    });

    it('throws for an unknown id', async () => {
      await expect(store.update('bad-id', { host: 'x' })).rejects.toThrow('Tenant not found');
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('removes the tenant row', async () => {
      const { id } = await store.create(BASE);
      await store.delete(id);
      expect(await store.findById(id)).toBeNull();
    });

    it('is a no-op for unknown id', async () => {
      await expect(store.delete('missing')).resolves.toBeUndefined();
    });
  });
});
