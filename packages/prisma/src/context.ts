import { useTenant } from '@kosan/core';
import type { PrismaClientLike } from './types.js';

/**
 * Returns the current tenant's `PrismaClient` instance.
 *
 * Must be called inside a request handled by `tenantMiddleware` (or equivalent).
 * Throws if called outside of a tenant context.
 *
 * ```ts
 * import { usePrisma } from '@kosan/prisma';
 * import type { PrismaClient } from '@prisma/client';
 *
 * app.get('/orders', async (req, res) => {
 *   const prisma = usePrisma<PrismaClient>();
 *   const orders = await prisma.order.findMany();
 *   res.json(orders);
 * });
 * ```
 */
export function usePrisma<TClient extends PrismaClientLike = PrismaClientLike>(): TClient {
  const { models } = useTenant<TClient>();
  if (!('prisma' in models)) {
    throw new Error(
      'usePrisma() requires the PrismaAdapter. ' +
        'Make sure your TenantRegistry is configured with a PrismaAdapter.',
    );
  }
  return models['prisma'] as TClient;
}
