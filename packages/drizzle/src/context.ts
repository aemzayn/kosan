import { useTenant } from '@kosan/core';
import type { DrizzleClientLike, DrizzleModels } from './types.js';

/**
 * Typed shortcut for accessing the current tenant's Drizzle client.
 *
 * @example
 * ```ts
 * import { useDrizzle } from '@kosan/drizzle';
 * import type { MyDb } from './db';
 *
 * app.get('/orders', (req, res) => {
 *   const db = useDrizzle<MyDb>();
 *   const orders = await db.select().from(ordersTable);
 *   res.json(orders);
 * });
 * ```
 */
export function useDrizzle<TClient extends DrizzleClientLike = DrizzleClientLike>(): TClient {
  const ctx = useTenant<TClient>();
  const models = ctx.models as unknown as DrizzleModels<TClient>;
  return models.drizzle;
}
