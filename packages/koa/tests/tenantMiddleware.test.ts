import Koa from 'koa';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  TenantNotActiveError,
  TenantNotFoundError,
  getCurrentTenant,
  useTenant,
} from '@huni/core';
import type { TenantConfig, TenantRegistry } from '@huni/core';
import { tenantMiddleware } from '../src/tenantMiddleware.js';

// ---------------------------------------------------------------------------
// Registry stub
// ---------------------------------------------------------------------------

const ACTIVE_TENANT: TenantConfig = {
  id: 'tenant-1',
  slug: 'acme',
  host: 'localhost',
  port: 5432,
  dbName: 'acme_db',
  user: 'u',
  password: 'p',
  status: 'active',
};

function makeRegistry(
  behaviour: 'found' | 'not-found' | 'suspended' | 'error' = 'found',
): TenantRegistry {
  return {
    resolveBySlug: vi.fn(async (slug: string) => {
      if (behaviour === 'not-found') throw new TenantNotFoundError(slug);
      if (behaviour === 'suspended') throw new TenantNotActiveError(slug, 'suspended');
      if (behaviour === 'error') throw new Error('registry exploded');
      return { tenant: ACTIVE_TENANT, connection: {}, models: { Order: {} } };
    }),
  } as unknown as TenantRegistry;
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildApp(
  registryBehaviour: Parameters<typeof makeRegistry>[0] = 'found',
  resolverSlug: string | null = 'acme',
) {
  const app = new Koa();
  app.silent = true;

  app.use(tenantMiddleware({
    registry: makeRegistry(registryBehaviour),
    resolver: { resolve: () => resolverSlug },
  }));

  app.use(async (ctx) => {
    const tc = useTenant();
    ctx.body = { slug: tc.tenant.slug };
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tenantMiddleware (Koa)', () => {
  describe('happy path', () => {
    it('sets the tenant context so useTenant() works in downstream middleware', async () => {
      const res = await request(buildApp().callback()).get('/');
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe('acme');
    });

    it('makes useTenant() available after async awaits', async () => {
      const app = new Koa();
      app.use(tenantMiddleware({ registry: makeRegistry('found'), resolver: { resolve: () => 'acme' } }));
      app.use(async (ctx) => {
        await Promise.resolve();
        ctx.body = { slug: useTenant().tenant.slug };
      });
      const res = await request(app.callback()).get('/');
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe('acme');
    });
  });

  describe('missing tenant identifier', () => {
    it('returns 400 when resolver returns null', async () => {
      const res = await request(buildApp('found', null).callback()).get('/');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Tenant identifier missing/);
    });

    it('calls onMissingTenant when provided', async () => {
      const app = new Koa();
      const onMissing = vi.fn(async (ctx: Koa.Context) => {
        ctx.status = 401;
        ctx.body = { custom: 'no tenant' };
      });
      app.use(tenantMiddleware({
        registry: makeRegistry('found'),
        resolver: { resolve: () => null },
        onMissingTenant: onMissing,
      }));
      app.use(async (ctx) => { ctx.body = {}; });

      const res = await request(app.callback()).get('/');
      expect(res.status).toBe(401);
      expect(onMissing).toHaveBeenCalledOnce();
    });
  });

  describe('tenant errors', () => {
    it('returns 404 for unknown tenant', async () => {
      const res = await request(buildApp('not-found', 'acme').callback()).get('/');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Tenant not found/);
    });

    it('returns 403 for suspended tenant', async () => {
      const res = await request(buildApp('suspended', 'acme').callback()).get('/');
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not active/);
    });

    it('propagates unexpected errors to Koa error handler', async () => {
      const app = new Koa();
      app.silent = true;
      app.use(tenantMiddleware({ registry: makeRegistry('error'), resolver: { resolve: () => 'acme' } }));
      app.use(async (ctx) => { ctx.body = {}; });

      const res = await request(app.callback()).get('/');
      expect(res.status).toBe(500);
    });
  });

  describe('resolver types', () => {
    it('accepts a plain function resolver', async () => {
      const app = new Koa();
      app.use(tenantMiddleware({ registry: makeRegistry('found'), resolver: () => 'acme' }));
      app.use(async (ctx) => { ctx.body = { slug: useTenant().tenant.slug }; });
      const res = await request(app.callback()).get('/');
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe('acme');
    });

    it('accepts an async function resolver', async () => {
      const app = new Koa();
      app.use(tenantMiddleware({
        registry: makeRegistry('found'),
        resolver: async () => { await Promise.resolve(); return 'acme'; },
      }));
      app.use(async (ctx) => { ctx.body = { slug: useTenant().tenant.slug }; });
      const res = await request(app.callback()).get('/');
      expect(res.status).toBe(200);
    });

    it('passes ctx.request to a Resolver instance', async () => {
      const app = new Koa();
      const resolver = { resolve: vi.fn(() => 'acme') };
      app.use(tenantMiddleware({ registry: makeRegistry('found'), resolver }));
      app.use(async (ctx) => { ctx.body = {}; });
      await request(app.callback()).get('/');
      expect(resolver.resolve).toHaveBeenCalledOnce();
    });
  });

  describe('context isolation', () => {
    it('isolates tenant context between concurrent requests', async () => {
      const app = new Koa();
      app.use(tenantMiddleware({
        registry: {
          resolveBySlug: vi.fn(async (slug: string) => ({
            tenant: { ...ACTIVE_TENANT, slug },
            connection: {},
            models: {},
          })),
        } as unknown as TenantRegistry,
        resolver: (ctx) => ctx.query['slug'] as string ?? null,
      }));
      app.use(async (ctx) => {
        await new Promise((r) => setTimeout(r, 10));
        ctx.body = { slug: getCurrentTenant()?.slug };
      });

      const [a, b] = await Promise.all([
        request(app.callback()).get('/?slug=alpha'),
        request(app.callback()).get('/?slug=beta'),
      ]);

      expect(a.body.slug).toBe('alpha');
      expect(b.body.slug).toBe('beta');
    });
  });
});
