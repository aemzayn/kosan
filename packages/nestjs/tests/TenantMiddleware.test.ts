import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { HttpException } from '@nestjs/common';
import {
  TenantNotFoundError,
  TenantNotActiveError,
  getCurrentTenant,
  runWithTenant,
} from '@huni/core';
import type { TenantConfig, TenantContextValue, TenantRegistry, Resolver } from '@huni/core';
import { TenantMiddleware } from '../src/TenantMiddleware.js';
import { HUNI_REGISTRY, HUNI_OPTIONS, HUNI_RESOLVER } from '../src/constants.js';

// ---------------------------------------------------------------------------
// Fixtures
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

const CTX: TenantContextValue = { tenant: TENANT, connection: {}, models: {} };

function makeRegistry(
  behaviour: 'found' | 'not-found' | 'suspended' | 'error' = 'found',
): TenantRegistry {
  return {
    resolveBySlug: vi.fn(async () => {
      if (behaviour === 'not-found') throw new TenantNotFoundError('slug=acme');
      if (behaviour === 'suspended') throw new TenantNotActiveError('acme', 'suspended');
      if (behaviour === 'error') throw new Error('DB exploded');
      return CTX;
    }),
  } as unknown as TenantRegistry;
}

function makeOptions(overrides: Partial<{ missingTenantStatus: number; onMissingTenant: (s: string) => void }> = {}) {
  return {
    master: {} as never,
    adapter: {} as never,
    resolver: {} as Resolver,
    ...overrides,
  };
}

function makeMiddleware(
  registry: TenantRegistry,
  resolver: Resolver,
  options = makeOptions(),
): TenantMiddleware {
  // Manually construct since we're not using the NestJS DI container.
  const mw = Object.create(TenantMiddleware.prototype) as TenantMiddleware;
  (mw as unknown as Record<symbol, unknown>)[HUNI_REGISTRY] = registry;
  (mw as unknown as Record<symbol, unknown>)[HUNI_RESOLVER] = resolver;
  (mw as unknown as Record<symbol, unknown>)[HUNI_OPTIONS] = options;
  // Assign via normal properties since @Inject binds by symbol key at runtime
  Object.assign(mw, { registry, resolver, options });
  return mw;
}

function stubRequest(slug?: string): Request {
  return { hostname: slug ? `${slug}.app.com` : 'app.com', headers: {} } as unknown as Request;
}

function stubRes(): Response {
  return {} as Response;
}

// ---------------------------------------------------------------------------
// Direct instantiation helper — bypasses NestJS DI, exercises the logic
// ---------------------------------------------------------------------------

function buildMiddleware(
  registryBehaviour: 'found' | 'not-found' | 'suspended' | 'error' = 'found',
  resolverResult: string | null = 'acme',
  options: Partial<{ missingTenantStatus: number; onMissingTenant: (s: string) => void }> = {},
): TenantMiddleware {
  const registry = makeRegistry(registryBehaviour);
  const resolver: Resolver = { resolve: () => resolverResult };
  // Construct without NestJS by directly assigning private fields
  const mw = new TenantMiddleware(
    registry,
    resolver,
    makeOptions(options),
  );
  return mw;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantMiddleware', () => {
  describe('happy path', () => {
    it('calls next() with tenant context available', async () => {
      const mw = buildMiddleware('found', 'acme');
      let tenantInNext: TenantConfig | undefined;

      const next: NextFunction = () => {
        tenantInNext = getCurrentTenant();
      };

      await mw.use(stubRequest('acme'), stubRes(), next);
      expect(tenantInNext?.slug).toBe('acme');
    });

    it('makes useTenant() return the correct value inside async next()', async () => {
      const mw = buildMiddleware('found', 'acme');
      let slugAfterAwait: string | undefined;

      const next: NextFunction = async () => {
        await Promise.resolve();
        slugAfterAwait = getCurrentTenant()?.slug;
      };

      await mw.use(stubRequest('acme'), stubRes(), next);
      expect(slugAfterAwait).toBe('acme');
    });
  });

  describe('resolver returns null', () => {
    it('throws HttpException 404 by default', async () => {
      const mw = buildMiddleware('found', null);
      await expect(mw.use(stubRequest(), stubRes(), vi.fn())).rejects.toBeInstanceOf(HttpException);
    });

    it('uses custom missingTenantStatus', async () => {
      const mw = buildMiddleware('found', null, { missingTenantStatus: 400 });
      await expect(mw.use(stubRequest(), stubRes(), vi.fn())).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('tenant errors', () => {
    it('throws HttpException 404 for TenantNotFoundError', async () => {
      const mw = buildMiddleware('not-found', 'acme');
      await expect(mw.use(stubRequest('acme'), stubRes(), vi.fn())).rejects.toMatchObject({
        status: 404,
      });
    });

    it('throws HttpException 404 for TenantNotActiveError', async () => {
      const mw = buildMiddleware('suspended', 'acme');
      await expect(mw.use(stubRequest('acme'), stubRes(), vi.fn())).rejects.toMatchObject({
        status: 404,
      });
    });

    it('calls onMissingTenant when tenant is not found', async () => {
      const onMissingTenant = vi.fn();
      const mw = buildMiddleware('not-found', 'acme', { onMissingTenant });
      await expect(mw.use(stubRequest('acme'), stubRes(), vi.fn())).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(onMissingTenant).toHaveBeenCalledWith('acme');
    });

    it('rethrows unexpected errors', async () => {
      const mw = buildMiddleware('error', 'acme');
      await expect(mw.use(stubRequest('acme'), stubRes(), vi.fn())).rejects.toThrow('DB exploded');
    });
  });

  describe('context isolation', () => {
    it('each request sees its own tenant', async () => {
      const slugA = 'alpha';
      const slugB = 'beta';

      const makeTenantCtx = (slug: string): TenantContextValue => ({
        tenant: { ...TENANT, slug },
        connection: {},
        models: {},
      });

      const registryA = {
        resolveBySlug: vi.fn(async () => makeTenantCtx(slugA)),
      } as unknown as TenantRegistry;
      const registryB = {
        resolveBySlug: vi.fn(async () => makeTenantCtx(slugB)),
      } as unknown as TenantRegistry;

      const mwA = new TenantMiddleware(registryA, { resolve: () => slugA }, makeOptions());
      const mwB = new TenantMiddleware(registryB, { resolve: () => slugB }, makeOptions());

      const results: string[] = [];

      await Promise.all([
        mwA.use(stubRequest(slugA), stubRes(), () => {
          results.push(getCurrentTenant()?.slug ?? 'none');
        }),
        mwB.use(stubRequest(slugB), stubRes(), () => {
          results.push(getCurrentTenant()?.slug ?? 'none');
        }),
      ]);

      expect(results).toContain(slugA);
      expect(results).toContain(slugB);
    });
  });
});
