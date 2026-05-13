import { describe, it, expect, vi } from 'vitest';
import { DrizzleMasterStore } from '../src/DrizzleMasterStore.js';
import type { DrizzleMasterStoreQueries } from '../src/types.js';
import type { TenantConfig, CreateTenantInput, UpdateTenantInput } from '@kosan/core';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const TENANT: TenantConfig = {
  id: 't-1',
  slug: 'acme',
  host: 'localhost',
  port: 5432,
  dbName: 'acme_db',
  user: 'u',
  password: 'p',
  status: 'active',
};

function makeQueries(overrides: Partial<DrizzleMasterStoreQueries> = {}): DrizzleMasterStoreQueries {
  return {
    findAll: vi.fn(async () => [TENANT]),
    findBySlug: vi.fn(async () => TENANT),
    findById: vi.fn(async () => TENANT),
    create: vi.fn(async (data: CreateTenantInput) => ({ ...TENANT, ...data })),
    update: vi.fn(async (_id: string, data: UpdateTenantInput) => ({ ...TENANT, ...data })),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DrizzleMasterStore', () => {
  it('findAll delegates to the query callback', async () => {
    const queries = makeQueries();
    const store = new DrizzleMasterStore(queries);

    const result = await store.findAll();
    expect(queries.findAll).toHaveBeenCalledWith(undefined);
    expect(result).toEqual([TENANT]);
  });

  it('findAll passes the status filter to the callback', async () => {
    const queries = makeQueries({ findAll: vi.fn(async () => []) });
    const store = new DrizzleMasterStore(queries);

    await store.findAll({ status: 'active' });
    expect(queries.findAll).toHaveBeenCalledWith({ status: 'active' });
  });

  it('findBySlug delegates to the query callback', async () => {
    const queries = makeQueries();
    const store = new DrizzleMasterStore(queries);

    const result = await store.findBySlug('acme');
    expect(queries.findBySlug).toHaveBeenCalledWith('acme');
    expect(result?.slug).toBe('acme');
  });

  it('findBySlug returns null when the callback returns null', async () => {
    const queries = makeQueries({ findBySlug: vi.fn(async () => null) });
    const store = new DrizzleMasterStore(queries);

    expect(await store.findBySlug('missing')).toBeNull();
  });

  it('findById delegates to the query callback', async () => {
    const queries = makeQueries();
    const store = new DrizzleMasterStore(queries);

    const result = await store.findById('t-1');
    expect(queries.findById).toHaveBeenCalledWith('t-1');
    expect(result?.id).toBe('t-1');
  });

  it('create delegates to the query callback', async () => {
    const queries = makeQueries();
    const store = new DrizzleMasterStore(queries);

    const input: CreateTenantInput = {
      slug: 'beta',
      host: 'localhost',
      port: 5432,
      dbName: 'beta_db',
      user: 'u',
      password: 'p',
    };
    await store.create(input);
    expect(queries.create).toHaveBeenCalledWith(input);
  });

  it('update delegates to the query callback', async () => {
    const queries = makeQueries();
    const store = new DrizzleMasterStore(queries);

    await store.update('t-1', { slug: 'acme-v2' });
    expect(queries.update).toHaveBeenCalledWith('t-1', { slug: 'acme-v2' });
  });

  it('delete delegates to the query callback', async () => {
    const queries = makeQueries();
    const store = new DrizzleMasterStore(queries);

    await store.delete('t-1');
    expect(queries.delete).toHaveBeenCalledWith('t-1');
  });
});
