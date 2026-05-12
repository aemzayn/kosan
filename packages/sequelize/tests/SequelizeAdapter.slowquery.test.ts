import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sequelize } from 'sequelize';
import { SequelizeAdapter } from '../src/SequelizeAdapter.js';
import type { SlowQueryInfo } from '../src/types.js';
import type { TenantConfig } from '@huni/core';

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

describe('SequelizeAdapter — slow-query detection', () => {
  const openConnections: Sequelize[] = [];

  afterEach(async () => {
    for (const conn of openConnections) {
      try { await conn.close(); } catch { /* already closed */ }
    }
    openConnections.length = 0;
    vi.restoreAllMocks();
  });

  it('does not call onSlowQuery when no queries exceed the threshold', async () => {
    const onSlowQuery = vi.fn<[SlowQueryInfo], void>();
    const adapter = new SequelizeAdapter({
      onSlowQuery,
      slowQueryThresholdMs: 5000, // very high — no query will hit this in tests
    });

    const tenant = makeTenant();
    const sequelize = await adapter.connect(tenant);
    openConnections.push(sequelize);

    // Run a trivially fast query.
    await sequelize.query('SELECT 1');

    expect(onSlowQuery).not.toHaveBeenCalled();
  });

  it('calls onSlowQuery with correct info when threshold is exceeded', async () => {
    const onSlowQuery = vi.fn<[SlowQueryInfo], void>();
    const adapter = new SequelizeAdapter({
      onSlowQuery,
      slowQueryThresholdMs: 0, // every query is "slow"
    });

    const tenant = makeTenant({ id: 't1', slug: 'acme' });
    const sequelize = await adapter.connect(tenant);
    openConnections.push(sequelize);

    await sequelize.query('SELECT 1');

    expect(onSlowQuery).toHaveBeenCalled();
    // Find the call matching our explicit query (Sequelize may emit internal queries too).
    const calls = onSlowQuery.mock.calls.map((c) => c[0]!);
    const ourCall = calls.find((c) => c.sql.includes('SELECT 1'));
    expect(ourCall).toBeDefined();
    expect(ourCall?.tenantId).toBe('t1');
    expect(ourCall?.tenantSlug).toBe('acme');
    expect(typeof ourCall?.durationMs).toBe('number');
    expect(ourCall?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('still calls user-supplied logging function alongside onSlowQuery', async () => {
    const logs: string[] = [];
    const onSlowQuery = vi.fn<[SlowQueryInfo], void>();

    const adapter = new SequelizeAdapter({
      logging: (sql) => { logs.push(sql); },
      onSlowQuery,
      slowQueryThresholdMs: 0,
    });

    const tenant = makeTenant();
    const sequelize = await adapter.connect(tenant);
    openConnections.push(sequelize);

    await sequelize.query('SELECT 42');

    expect(logs.length).toBeGreaterThan(0);
    expect(onSlowQuery).toHaveBeenCalled();
  });

  it('works without onSlowQuery — falls back to original logging option', async () => {
    const logs: string[] = [];
    const adapter = new SequelizeAdapter({
      logging: (sql) => { logs.push(sql); },
    });

    const tenant = makeTenant();
    const sequelize = await adapter.connect(tenant);
    openConnections.push(sequelize);

    await sequelize.query('SELECT 99');
    expect(logs.length).toBeGreaterThan(0);
  });

  it('passes tenantId and tenantSlug from the tenant row', async () => {
    const calls: SlowQueryInfo[] = [];
    const adapter = new SequelizeAdapter({
      onSlowQuery: (info) => calls.push(info),
      slowQueryThresholdMs: 0,
    });

    const tenant = makeTenant({ id: 'tid-123', slug: 'initech' });
    const sequelize = await adapter.connect(tenant);
    openConnections.push(sequelize);

    await sequelize.query('SELECT 1');

    expect(calls[0]?.tenantId).toBe('tid-123');
    expect(calls[0]?.tenantSlug).toBe('initech');
  });
});
