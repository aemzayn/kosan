import { Module, DynamicModule, Global } from '@nestjs/common';
import { TenantRegistry } from '@huni/core';
import { HUNI_REGISTRY, HUNI_OPTIONS, HUNI_RESOLVER } from './constants.js';
import { TenantMiddleware } from './TenantMiddleware.js';
import { TenantGuard } from './TenantGuard.js';
import type { HuniOptions, HuniAsyncOptions } from './types.js';

function registryFactory<TConn>(options: HuniOptions<TConn>): Promise<TenantRegistry<TConn>> {
  // Strip NestJS-specific options before passing to TenantRegistry
  const { resolver: _r, missingTenantStatus: _m, onMissingTenant: _o, ...registryOptions } = options;
  return TenantRegistry.create(registryOptions);
}

@Global()
@Module({})
export class HuniModule {
  /**
   * Register Huni synchronously.
   *
   *   HuniModule.forRoot({
   *     resolver: new SubdomainResolver(),
   *     master: new SequelizeMasterStore(masterSequelize),
   *     adapter: new SequelizeAdapter({ ... }),
   *   })
   */
  static forRoot<TConn = unknown>(options: HuniOptions<TConn>): DynamicModule {
    return {
      module: HuniModule,
      providers: [
        { provide: HUNI_OPTIONS, useValue: options },
        { provide: HUNI_RESOLVER, useValue: options.resolver },
        {
          provide: HUNI_REGISTRY,
          useFactory: () => registryFactory(options),
        },
        TenantMiddleware,
        TenantGuard,
      ],
      exports: [HUNI_REGISTRY, HUNI_OPTIONS, HUNI_RESOLVER, TenantMiddleware, TenantGuard],
    };
  }

  /**
   * Register Huni asynchronously (e.g., options come from ConfigService).
   *
   *   HuniModule.forRootAsync({
   *     imports: [ConfigModule],
   *     inject: [ConfigService],
   *     useFactory: (config: ConfigService) => ({
   *       resolver: new SubdomainResolver(),
   *       master: new SequelizeMasterStore(masterSequelize),
   *       adapter: new SequelizeAdapter({ dialect: 'postgres', ... }),
   *     }),
   *   })
   */
  static forRootAsync<TConn = unknown>(asyncOptions: HuniAsyncOptions<TConn>): DynamicModule {
    return {
      module: HuniModule,
      imports: asyncOptions.imports ?? [],
      providers: [
        {
          provide: HUNI_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: (asyncOptions.inject ?? []) as never[],
        },
        {
          provide: HUNI_REGISTRY,
          useFactory: (options: HuniOptions<TConn>) => registryFactory(options),
          inject: [HUNI_OPTIONS],
        },
        {
          provide: HUNI_RESOLVER,
          useFactory: (options: HuniOptions<TConn>) => options.resolver,
          inject: [HUNI_OPTIONS],
        },
        TenantMiddleware,
        TenantGuard,
      ],
      exports: [HUNI_REGISTRY, HUNI_OPTIONS, HUNI_RESOLVER, TenantMiddleware, TenantGuard],
    };
  }
}
