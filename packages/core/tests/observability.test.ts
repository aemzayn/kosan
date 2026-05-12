import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getHealthPayload, getTenantLogContext } from '../src/observability.js';
import { runWithTenant } from '../src/TenantContext.js';
import { TenantRegistry } from '../src/TenantRegistry.js';
import { FakeAdapter } from './helpers/FakeAdapter.js';
import { InMemoryMasterStore } from './helpers/InMemoryMasterStore.js';
import type { TenantConfig } from '../src/types.js';

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    id: 'tenant-1',
    slug: 'acme',
    host: 'localhost',
    port: 5432,
    dbName: 'acme_db',
    user: 'acme',
    password: 'secret',
    status: 'active',
    ...overrides,
  };
}

describe('getTenantLogContext', () => {
  it('returns empty object outside a tenant context', () => {
    const ctx = getTenantLogContext();
    expect(ctx).toEqual({});
  });

  it('returns tenantId and tenantSlug inside a tenant context', async () => {
    const tenant = makeTenantConfig();
    const fakeCtx = { tenant, connection: {}, models: {} };

    await runWithTenant(fakeCtx, async () => {
      const logCtx = getTenantLogContext();
      expect(logCtx).toEqual({ tenantId: 'tenant-1', tenantSlug: 'acme' });
    });
  });
});

describe('getHealthPayload', () => {
  let master: InMemoryMasterStore;
  let adapter: FakeAdapter;
  let registry: TenantRegistry;

  beforeEach(async () => {
    master = new InMemoryMasterStore();
    adapter = new FakeAdapter();
    registry = await TenantRegistry.create({ master, adapter, cache: { maxSize: 10 } });
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  it('reports zero connections on an empty cache', () => {
    const health = getHealthPayload(registry);
    expect(health.cacheSize).toBe(0);
    expect(health.cacheMaxSize).toBe(10);
    expect(health.tenantCount).toBe(0);
    expect(health.entries).toEqual([]);
  });

  it('reflects live cache state after resolving a tenant', async () => {
    await master.create({
      slug: 'acme',
      host: 'localhost',
      port: 5432,
      dbName: 'acme_db',
      user: 'acme',
      password: 'secret',
    });
    await registry.resolveBySlug('acme');

    const health = getHealthPayload(registry);
    expect(health.cacheSize).toBe(1);
    expect(health.tenantCount).toBe(1);
    expect(health.entries).toHaveLength(1);
    expect(health.entries[0]?.tenantSlug).toBe('acme');
    expect(typeof health.entries[0]?.idleMs).toBe('number');
    expect(health.entries[0]?.idleMs).toBeGreaterThanOrEqual(0);
  });
});

describe('TenantRegistry.getStats', () => {
  let master: InMemoryMasterStore;
  let adapter: FakeAdapter;
  let registry: TenantRegistry;

  beforeEach(async () => {
    master = new InMemoryMasterStore();
    adapter = new FakeAdapter();
    registry = await TenantRegistry.create({ master, adapter, cache: { maxSize: 50 } });
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  it('returns cacheSize, cacheMaxSize, and entries', async () => {
    const stats = registry.getStats();
    expect(stats.cacheSize).toBe(0);
    expect(stats.cacheMaxSize).toBe(50);
    expect(stats.entries).toEqual([]);
  });

  it('includes entry stats after connecting', async () => {
    await master.create({
      slug: 'globex',
      host: 'localhost',
      port: 5432,
      dbName: 'globex_db',
      user: 'globex',
      password: 'secret',
    });
    await registry.resolveBySlug('globex');

    const stats = registry.getStats();
    expect(stats.cacheSize).toBe(1);
    expect(stats.entries[0]?.tenantId).toBeTruthy();
    expect(stats.entries[0]?.idleMs).toBeGreaterThanOrEqual(0);
  });
});

describe('CacheStats.idleMs', () => {
  it('reports idleMs as time since last use', async () => {
    const master = new InMemoryMasterStore();
    const adapter = new FakeAdapter();
    const registry = await TenantRegistry.create({ master, adapter });
    await master.create({
      slug: 'initech',
      host: 'localhost',
      port: 5432,
      dbName: 'initech_db',
      user: 'initech',
      password: 'secret',
    });

    const before = Date.now();
    await registry.resolveBySlug('initech');
    const after = Date.now();

    const stats = registry.getStats();
    const idle = stats.entries[0]?.idleMs ?? -1;
    expect(idle).toBeGreaterThanOrEqual(0);
    expect(idle).toBeLessThanOrEqual(after - before + 50); // small tolerance

    await registry.shutdown();
  });
});
