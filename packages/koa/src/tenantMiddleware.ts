import {
  TenantNotActiveError,
  TenantNotFoundError,
  runWithTenant,
} from '@kosan/core';
import type { Resolver, TenantRegistry } from '@kosan/core';
import type { Context, Next } from 'koa';

export interface TenantMiddlewareOptions {
  registry: TenantRegistry;
  /**
   * A `Resolver` instance or a plain async/sync function
   * `(ctx) => slug | null`.
   *
   * When a `Resolver` is provided its `.resolve()` is called with
   * `ctx.request` so it receives `{ headers, path, url }`.
   */
  resolver: Resolver | ((ctx: Context) => string | null | Promise<string | null>);
  /**
   * Called when no tenant identifier is found in the request.
   * Default: responds 400 Bad Request and does NOT call `next`.
   */
  onMissingTenant?: (ctx: Context, next: Next) => Promise<void>;
}

function toResolver(
  r: TenantMiddlewareOptions['resolver'],
): (ctx: Context) => string | null | Promise<string | null> {
  if (typeof r === 'function') return r;
  // Koa's ctx.request has headers, path, url — compatible with resolver shape.
  return (ctx) => r.resolve(ctx.request as Parameters<Resolver['resolve']>[0]);
}

export function tenantMiddleware(options: TenantMiddlewareOptions) {
  const resolve = toResolver(options.resolver);

  const onMissing =
    options.onMissingTenant ??
    (async (ctx: Context) => {
      ctx.status = 400;
      ctx.body = { error: 'Tenant identifier missing from request.' };
    });

  return async function tenantMiddlewareFn(ctx: Context, next: Next): Promise<void> {
    let slug: string | null;

    try {
      slug = await resolve(ctx);
    } catch (err) {
      ctx.throw(500, String(err));
      return;
    }

    if (slug === null || slug === '') {
      await onMissing(ctx, next);
      return;
    }

    let tenantCtx: Awaited<ReturnType<TenantRegistry['resolveBySlug']>>;

    try {
      tenantCtx = await options.registry.resolveBySlug(slug);
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        ctx.status = 404;
        ctx.body = { error: `Tenant not found: ${slug}` };
        return;
      }
      if (err instanceof TenantNotActiveError) {
        ctx.status = 403;
        ctx.body = { error: err.message };
        return;
      }
      throw err;
    }

    // Koa's `next()` is a proper Promise, so runWithTenant wraps the entire
    // downstream middleware chain — the context is available everywhere.
    await runWithTenant(tenantCtx, () => next());
  };
}
