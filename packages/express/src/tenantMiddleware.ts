import {
  TenantNotActiveError,
  TenantNotFoundError,
  runWithTenant,
} from '@huni/core';
import type { Resolver, TenantRegistry } from '@huni/core';
import type { NextFunction, Request, Response } from 'express';

export interface TenantMiddlewareOptions {
  registry: TenantRegistry;
  /**
   * A `Resolver` instance (`SubdomainResolver`, `HeaderResolver`, `PathResolver`)
   * or a plain async/sync function `(req) => slug | null`.
   */
  resolver: Resolver | ((req: Request) => string | null | Promise<string | null>);
  /**
   * Called when no tenant identifier is found in the request.
   * Default: responds 400 Bad Request.
   */
  onMissingTenant?: (req: Request, res: Response, next: NextFunction) => void;
}

function toResolver(
  r: TenantMiddlewareOptions['resolver'],
): (req: Request) => string | null | Promise<string | null> {
  if (typeof r === 'function') return r;
  return (req) => r.resolve(req);
}

export function tenantMiddleware(options: TenantMiddlewareOptions) {
  const resolve = toResolver(options.resolver);

  const onMissing =
    options.onMissingTenant ??
    ((_req: Request, res: Response) => {
      res.status(400).json({ error: 'Tenant identifier missing from request.' });
    });

  return async function tenantMiddlewareFn(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    let slug: string | null;

    try {
      slug = await resolve(req);
    } catch (err) {
      next(err);
      return;
    }

    if (slug === null || slug === '') {
      onMissing(req, res, next);
      return;
    }

    let ctx: Awaited<ReturnType<TenantRegistry['resolveBySlug']>>;

    try {
      ctx = await options.registry.resolveBySlug(slug);
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        res.status(404).json({ error: `Tenant not found: ${slug}` });
        return;
      }
      if (err instanceof TenantNotActiveError) {
        res.status(403).json({ error: err.message });
        return;
      }
      next(err);
      return;
    }

    // Run the rest of the chain inside the tenant context. AsyncLocalStorage
    // propagates to all async work started within the run() callback, so every
    // downstream handler can call useTenant() even after awaiting.
    runWithTenant(ctx, async () => next());
  };
}
