import { describe, expect, it } from 'vitest';
import { getCurrentTenant, runWithTenant, useTenant } from '../src/TenantContext.js';
import type { TenantConfig, TenantContextValue } from '../src/types.js';

const TENANT: TenantConfig = {
  id: 'tenant-1',
  slug: 'acme',
  host: 'localhost',
  port: 5432,
  dbName: 'acme_db',
  user: 'acme_user',
  password: 'secret',
  status: 'active',
};

const CTX: TenantContextValue = {
  tenant: TENANT,
  connection: { fake: true },
  models: { Order: {} },
};

describe('runWithTenant / useTenant', () => {
  it('makes the context available inside fn via useTenant()', async () => {
    await runWithTenant(CTX, async () => {
      const ctx = useTenant();
      expect(ctx.tenant.slug).toBe('acme');
      expect(ctx.connection).toEqual({ fake: true });
      expect(ctx.models.Order).toBeDefined();
    });
  });

  it('throws outside of a tenant context', () => {
    expect(() => useTenant()).toThrow(/useTenant\(\) was called outside/);
  });

  it('propagates context through nested async calls', async () => {
    const inner = async () => {
      await Promise.resolve(); // yield to event loop
      return useTenant().tenant.slug;
    };

    const result = await runWithTenant(CTX, inner);
    expect(result).toBe('acme');
  });

  it('isolates contexts between concurrent runs', async () => {
    const ctxA: TenantContextValue = { ...CTX, tenant: { ...TENANT, slug: 'alpha' } };
    const ctxB: TenantContextValue = { ...CTX, tenant: { ...TENANT, id: 't2', slug: 'beta' } };

    const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

    const [a, b] = await Promise.all([
      runWithTenant(ctxA, async () => {
        await delay(10);
        return useTenant().tenant.slug;
      }),
      runWithTenant(ctxB, async () => {
        await delay(5);
        return useTenant().tenant.slug;
      }),
    ]);

    expect(a).toBe('alpha');
    expect(b).toBe('beta');
  });

  it('returns value from fn', async () => {
    const result = await runWithTenant(CTX, async () => 42);
    expect(result).toBe(42);
  });
});

describe('getCurrentTenant', () => {
  it('returns undefined outside of a context', () => {
    expect(getCurrentTenant()).toBeUndefined();
  });

  it('returns the tenant inside a context', async () => {
    await runWithTenant(CTX, async () => {
      expect(getCurrentTenant()?.slug).toBe('acme');
    });
  });
});
