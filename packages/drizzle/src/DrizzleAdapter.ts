import type { Adapter, TenantConfig } from '@huni/core';
import type { DrizzleAdapterOptions, DrizzleClientLike, DrizzleModels } from './types.js';

export class DrizzleAdapter<TClient extends DrizzleClientLike>
  implements Adapter<TClient>
{
  private readonly options: DrizzleAdapterOptions<TClient>;

  constructor(options: DrizzleAdapterOptions<TClient>) {
    this.options = options;
  }

  async connect(tenant: TenantConfig): Promise<TClient> {
    return this.options.clientFactory(tenant);
  }

  async disconnect(client: TClient): Promise<void> {
    const underlying = client.$client;
    if (underlying === undefined) return;

    if (typeof underlying.end === 'function') {
      await underlying.end();
    } else if (typeof underlying.close === 'function') {
      await underlying.close();
    } else if (typeof underlying.destroy === 'function') {
      underlying.destroy();
    }
  }

  getModels(client: TClient): Record<string, unknown> {
    const models: DrizzleModels<TClient> = { drizzle: client };
    return models as unknown as Record<string, unknown>;
  }
}
