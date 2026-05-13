import { Module, DynamicModule, Global } from '@nestjs/common';
import { TenantRegistry } from '@kosan/core';
import { KOSAN_REGISTRY, KOSAN_OPTIONS, KOSAN_RESOLVER } from './constants.js';
import { TenantMiddleware } from './TenantMiddleware.js';
import { TenantGuard } from './TenantGuard.js';
import type { KosanOptions, KosanAsyncOptions } from './types.js';

function registryFactory<TConn>(options: KosanOptions<TConn>): Promise<TenantRegistry<TConn>> {
  // Strip NestJS-specific options before passing to TenantRegistry
  const { resolver: _r, missingTenantStatus: _m, onMissingTenant: _o, ...registryOptions } = options;
  return TenantRegistry.create(registryOptions);
}

@Global()
@Module({})
export class KosanModule {
  /**
   * Register Kosan synchronously.
   *
   *   KosanModule.forRoot({
   *     resolver: new SubdomainResolver(),
   *     master: new SequelizeMasterStore(masterSequelize),
   *     adapter: new SequelizeAdapter({ ... }),
   *   })
   */
  static forRoot<TConn = unknown>(options: KosanOptions<TConn>): DynamicModule {
    return {
      module: KosanModule,
      providers: [
        { provide: KOSAN_OPTIONS, useValue: options },
        { provide: KOSAN_RESOLVER, useValue: options.resolver },
        {
          provide: KOSAN_REGISTRY,
          useFactory: () => registryFactory(options),
        },
        TenantMiddleware,
        TenantGuard,
      ],
      exports: [KOSAN_REGISTRY, KOSAN_OPTIONS, KOSAN_RESOLVER, TenantMiddleware, TenantGuard],
    };
  }

  /**
   * Register Kosan asynchronously (e.g., options come from ConfigService).
   *
   *   KosanModule.forRootAsync({
   *     imports: [ConfigModule],
   *     inject: [ConfigService],
   *     useFactory: (config: ConfigService) => ({
   *       resolver: new SubdomainResolver(),
   *       master: new SequelizeMasterStore(masterSequelize),
   *       adapter: new SequelizeAdapter({ dialect: 'postgres', ... }),
   *     }),
   *   })
   */
  static forRootAsync<TConn = unknown>(asyncOptions: KosanAsyncOptions<TConn>): DynamicModule {
    return {
      module: KosanModule,
      imports: asyncOptions.imports ?? [],
      providers: [
        {
          provide: KOSAN_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: (asyncOptions.inject ?? []) as never[],
        },
        {
          provide: KOSAN_REGISTRY,
          useFactory: (options: KosanOptions<TConn>) => registryFactory(options),
          inject: [KOSAN_OPTIONS],
        },
        {
          provide: KOSAN_RESOLVER,
          useFactory: (options: KosanOptions<TConn>) => options.resolver,
          inject: [KOSAN_OPTIONS],
        },
        TenantMiddleware,
        TenantGuard,
      ],
      exports: [KOSAN_REGISTRY, KOSAN_OPTIONS, KOSAN_RESOLVER, TenantMiddleware, TenantGuard],
    };
  }
}
