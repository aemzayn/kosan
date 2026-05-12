import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrizzleAdapter } from '../src/DrizzleAdapter.js';
import type { DrizzleClientLike } from '../src/types.js';
import type { TenantConfig } from '@huni/core';

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

// ---------------------------------------------------------------------------
// Fake client
// ---------------------------------------------------------------------------

function makeClient(overrides: Partial<DrizzleClientLike['$client']> = {}): DrizzleClientLike {
  return {
    $client: {
      end: vi.fn(async () => {}),
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DrizzleAdapter', () => {
  describe('connect', () => {
    it('calls clientFactory with the tenant', async () => {
      const factory = vi.fn(async (_t: TenantConfig) => makeClient());
      const adapter = new DrizzleAdapter({ clientFactory: factory });

      await adapter.connect(TENANT);
      expect(factory).toHaveBeenCalledWith(TENANT);
    });

    it('returns the client produced by the factory', async () => {
      const client = makeClient();
      const adapter = new DrizzleAdapter({ clientFactory: async () => client });

      const result = await adapter.connect(TENANT);
      expect(result).toBe(client);
    });

    it('supports synchronous factories', async () => {
      const client = makeClient();
      const adapter = new DrizzleAdapter({ clientFactory: () => client });

      const result = await adapter.connect(TENANT);
      expect(result).toBe(client);
    });
  });

  describe('disconnect', () => {
    it('calls $client.end() when available', async () => {
      const client = makeClient();
      const adapter = new DrizzleAdapter({ clientFactory: async () => client });

      await adapter.disconnect(client);
      expect(client.$client?.end).toHaveBeenCalledOnce();
    });

    it('calls $client.close() when end is not available', async () => {
      const close = vi.fn(async () => {});
      const client: DrizzleClientLike = { $client: { close } };
      const adapter = new DrizzleAdapter({ clientFactory: async () => client });

      await adapter.disconnect(client);
      expect(close).toHaveBeenCalledOnce();
    });

    it('calls $client.destroy() when neither end nor close is available', async () => {
      const destroy = vi.fn();
      const client: DrizzleClientLike = { $client: { destroy } };
      const adapter = new DrizzleAdapter({ clientFactory: async () => client });

      await adapter.disconnect(client);
      expect(destroy).toHaveBeenCalledOnce();
    });

    it('does nothing when $client is undefined', async () => {
      const client: DrizzleClientLike = {};
      const adapter = new DrizzleAdapter({ clientFactory: async () => client });

      await expect(adapter.disconnect(client)).resolves.toBeUndefined();
    });
  });

  describe('getModels', () => {
    it('returns an object with the drizzle key set to the client', () => {
      const client = makeClient();
      const adapter = new DrizzleAdapter({ clientFactory: async () => client });

      const models = adapter.getModels(client);
      expect(models['drizzle']).toBe(client);
    });
  });
});
