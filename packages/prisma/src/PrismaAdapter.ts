import type { Adapter, ModelFactory, TenantConfig } from '@huni/core';
import type {
  PrismaAdapterOptions,
  PrismaClientLike,
  PrismaModels,
} from './types.js';

/**
 * Adapter that creates one `PrismaClient` instance per tenant, overriding
 * the datasource URL so each tenant connects to its own database.
 *
 * ```ts
 * import { PrismaClient } from '@prisma/client';
 * import { PrismaAdapter } from '@huni/prisma';
 *
 * const adapter = new PrismaAdapter({
 *   PrismaClient,
 *   buildUrl: (t) => `postgresql://${t.user}:${t.password}@${t.host}:${t.port}/${t.dbName}`,
 * });
 * ```
 */
export class PrismaAdapter<TClient extends PrismaClientLike>
  implements Adapter<TClient>
{
  private readonly options: Required<PrismaAdapterOptions<TClient>>;

  constructor(options: PrismaAdapterOptions<TClient>) {
    this.options = {
      datasourceName: 'db',
      ...options,
    };
  }

  async connect(tenant: TenantConfig): Promise<TClient> {
    const url = this.options.buildUrl(tenant);
    const client = new this.options.PrismaClient({
      datasources: { [this.options.datasourceName]: { url } },
    });
    await client.$connect();
    return client;
  }

  async disconnect(client: TClient): Promise<void> {
    await client.$disconnect();
  }

  /**
   * Returns `{ prisma: client }` so handlers can destructure cleanly:
   *
   * ```ts
   * const { models } = useTenant<PrismaClient>();
   * await models.prisma.order.findMany();
   * ```
   *
   * Or use the `usePrisma()` helper from `@huni/prisma` for a typed shortcut.
   */
  getModels(client: TClient): PrismaModels<TClient> {
    return { prisma: client };
  }

  /**
   * `PrismaAdapter` does not use model factories — models are accessed directly
   * via the `PrismaClient` instance. Calling this method throws.
   */
  registerModelFactories(_factories: ModelFactory<TClient>[]): void {
    throw new Error(
      'PrismaAdapter does not support registerModelFactories. ' +
        'Access models via useTenant().models.prisma (or usePrisma()) instead.',
    );
  }
}
