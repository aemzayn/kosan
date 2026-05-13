import { useTenant } from "@kosan/core";
import { Inject, createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { KOSAN_REGISTRY } from "./constants.js";

/** Inject the TenantRegistry instance. */
export const InjectRegistry = (): ReturnType<typeof Inject> => Inject(KOSAN_REGISTRY);

/**
 * Route-handler parameter decorator — resolves to the current TenantContextValue.
 *
 * Usage:
 *   async getOrders(@CurrentTenant() ctx: TenantContextValue) { ... }
 *
 * Requires TenantGuard to be active (globally or on the controller/method).
 */
export const CurrentTenant = createParamDecorator((_data: unknown, _ctx: ExecutionContext) => {
  return useTenant();
});
