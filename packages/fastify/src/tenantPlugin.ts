import { TenantNotActiveError, TenantNotFoundError, wrapWithTenantContext } from "@kosan/core";
import type { Resolver, TenantRegistry } from "@kosan/core";
import type {
  FastifyBaseLogger,
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
  FastifyTypeProviderDefault,
  RawServerDefault,
} from "fastify";
import fp from "fastify-plugin";

export interface TenantPluginOptions {
  registry: TenantRegistry;
  /**
   * A `Resolver` instance or a plain async/sync function
   * `(request) => slug | null`.
   */
  resolver: Resolver | ((request: FastifyRequest) => string | null | Promise<string | null>);
  /**
   * Called when no tenant identifier is found in the request.
   * Default: responds 400 Bad Request.
   */
  onMissingTenant?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
}

function toResolver(
  r: TenantPluginOptions["resolver"],
): (req: FastifyRequest) => string | null | Promise<string | null> {
  if (typeof r === "function") return r;
  return (req) => r.resolve(req);
}

const tenantPluginImpl: FastifyPluginCallback<
  TenantPluginOptions,
  RawServerDefault,
  FastifyTypeProviderDefault,
  FastifyBaseLogger
> = (fastify, options, pluginDone) => {
  const resolve = toResolver(options.resolver);

  const onMissing =
    options.onMissingTenant ??
    ((_req: FastifyRequest, reply: FastifyReply) => {
      void reply.status(400).send({ error: "Tenant identifier missing from request." });
    });

  // Use the callback-based hook (not async) so we can call done() inside
  // wrapWithTenantContext. Fastify schedules its next lifecycle step from
  // within done(), which means it inherits the tenant async context created
  // by storage.run() — making useTenant() available in route handlers.
  fastify.addHook("onRequest", (request, reply, done) => {
    Promise.resolve()
      .then(() => resolve(request))
      .then(async (slug) => {
        if (slug === null || slug === "") {
          await onMissing(request, reply);
          done();
          return;
        }

        let ctx: Awaited<ReturnType<TenantRegistry["resolveBySlug"]>>;
        try {
          ctx = await options.registry.resolveBySlug(slug);
        } catch (err) {
          if (err instanceof TenantNotFoundError) {
            void reply.status(404).send({ error: `Tenant not found: ${slug}` });
            done();
            return;
          }
          if (err instanceof TenantNotActiveError) {
            void reply.status(403).send({ error: err.message });
            done();
            return;
          }
          done(err as Error);
          return;
        }

        // done() is called inside storage.run(ctx, ...) so Fastify's
        // continuation (hook chain → route handler) runs with ctx in store.
        wrapWithTenantContext(ctx, done);
      })
      .catch((err: Error) => done(err));
  });

  pluginDone();
};

/**
 * Fastify plugin that resolves the tenant for every request and sets the
 * `AsyncLocalStorage` context so `useTenant()` is available in any handler.
 *
 * ```ts
 * import tenantPlugin from '@kosan/fastify';
 * import { SubdomainResolver } from '@kosan/core';
 *
 * await fastify.register(tenantPlugin, {
 *   registry,
 *   resolver: new SubdomainResolver(),
 * });
 * ```
 */
export default fp(tenantPluginImpl, {
  fastify: "4.x || 5.x",
  name: "@kosan/fastify",
});
