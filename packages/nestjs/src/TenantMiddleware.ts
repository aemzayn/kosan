import {
  TenantNotActiveError,
  TenantNotFoundError,
  type TenantRegistry,
  runWithTenant,
} from "@kosan/core";
import type { Resolver } from "@kosan/core";
import { HttpException, Inject, Injectable } from "@nestjs/common";
import type { NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { KOSAN_OPTIONS, KOSAN_REGISTRY, KOSAN_RESOLVER } from "./constants.js";
import type { KosanOptions } from "./types.js";

/**
 * NestJS middleware that resolves the current tenant and wraps the rest of
 * the Express handler chain inside `runWithTenant()`. This ensures that
 * `useTenant()` / `getCurrentTenant()` work in guards, interceptors, and
 * route handlers downstream.
 *
 * Register globally in `AppModule.configure()`:
 *
 *   configure(consumer: MiddlewareConsumer) {
 *     consumer.apply(TenantMiddleware).forRoutes('*');
 *   }
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @Inject(KOSAN_REGISTRY) private readonly registry: TenantRegistry,
    @Inject(KOSAN_RESOLVER) private readonly resolver: Resolver,
    @Inject(KOSAN_OPTIONS) private readonly options: KosanOptions,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const slug = await this.resolver.resolve(req);

    if (slug === null) {
      const status = this.options.missingTenantStatus ?? 404;
      throw new HttpException("Tenant not found", status);
    }

    try {
      const ctx = await this.registry.resolveBySlug(slug);
      // runWithTenant wraps next() inside AsyncLocalStorage.run() so the entire
      // downstream Express/NestJS chain inherits the tenant context.
      runWithTenant(ctx, next as () => void);
    } catch (err) {
      if (err instanceof TenantNotFoundError || err instanceof TenantNotActiveError) {
        const status = this.options.missingTenantStatus ?? 404;
        if (this.options.onMissingTenant) {
          await this.options.onMissingTenant(slug);
        }
        throw new HttpException((err as Error).message, status);
      }
      throw err;
    }
  }
}
