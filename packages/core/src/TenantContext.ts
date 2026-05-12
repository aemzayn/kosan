import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantConfig, TenantContextValue } from './types.js';

const storage = new AsyncLocalStorage<TenantContextValue>();

/**
 * Runs `fn` inside a tenant context. Any call to `useTenant()` within `fn`
 * (including nested async work) will return `value`.
 *
 * Intended for use by middleware adapters — not typically called by
 * application code directly.
 */
export function runWithTenant<T>(value: TenantContextValue, fn: () => Promise<T>): Promise<T> {
  return storage.run(value, fn);
}

/**
 * Returns the current tenant context. Throws if called outside of a
 * tenant-aware request (i.e., outside `runWithTenant`).
 */
export function useTenant<TConn = unknown>(): TenantContextValue<TConn> {
  const ctx = storage.getStore() as TenantContextValue<TConn> | undefined;
  if (ctx === undefined) {
    throw new Error(
      'useTenant() was called outside of a tenant context. ' +
        'Ensure your request passes through tenantMiddleware (or equivalent) before calling useTenant().',
    );
  }
  return ctx;
}

/** Returns the current tenant config, or `undefined` if there is no active context. */
export function getCurrentTenant(): TenantConfig | undefined {
  return storage.getStore()?.tenant;
}

/**
 * Calls `callback` synchronously inside a new tenant async context created
 * with `storage.run()`. Any async work that `callback` **schedules** (e.g.
 * by calling Fastify's `done()`) will inherit the context.
 *
 * This is the correct primitive for frameworks (e.g. Fastify) whose hook
 * system uses callbacks: call `done` inside this wrapper so that Fastify's
 * continuation is spawned within the tenant context.
 *
 * ```ts
 * fastify.addHook('onRequest', (req, reply, done) => {
 *   resolveCtx(req).then(ctx => {
 *     wrapWithTenantContext(ctx, done);
 *   }).catch(done);
 * });
 * ```
 *
 * Prefer `runWithTenant` for async-function style hooks (Express / Koa).
 */
export function wrapWithTenantContext(value: TenantContextValue, callback: () => void): void {
  storage.run(value, callback);
}
