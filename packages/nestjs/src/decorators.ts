import { Inject, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { useTenant } from '@huni/core';
import { HUNI_REGISTRY } from './constants.js';

/** Inject the TenantRegistry instance. */
export const InjectRegistry = (): ReturnType<typeof Inject> => Inject(HUNI_REGISTRY);

/**
 * Route-handler parameter decorator — resolves to the current TenantContextValue.
 *
 * Usage:
 *   async getOrders(@CurrentTenant() ctx: TenantContextValue) { ... }
 *
 * Requires TenantGuard to be active (globally or on the controller/method).
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext) => {
    return useTenant();
  },
);
