import { getCurrentTenant } from "@kosan/core";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";

/**
 * Guard that enforces a tenant is present in the current request context.
 *
 * Use this on controllers or routes where a tenant is required after
 * `TenantMiddleware` has already run. It does NOT resolve the tenant itself
 * — that's `TenantMiddleware`'s job.
 *
 * Apply globally:
 *   providers: [{ provide: APP_GUARD, useClass: TenantGuard }]
 *
 * Or per-controller:
 *   @UseGuards(TenantGuard)
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(_executionContext: ExecutionContext): boolean {
    if (getCurrentTenant() === undefined) {
      throw new UnauthorizedException("No tenant context — ensure TenantMiddleware is applied");
    }
    return true;
  }
}
