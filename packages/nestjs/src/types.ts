import type { ModuleMetadata, Type } from '@nestjs/common';
import type { TenantRegistryOptions, Resolver } from '@huni/core';

export interface HuniOptions<TConn = unknown> extends TenantRegistryOptions<TConn> {
  /** Resolver used by TenantGuard to identify the current tenant. */
  resolver: Resolver;
  /**
   * HTTP status to return when no tenant matches. Defaults to 404.
   * Use 400 if your app always requires a tenant but the client sent a bad slug.
   */
  missingTenantStatus?: number;
  /**
   * Called when the resolver returns a slug but no tenant is found or the
   * tenant is not active. If provided, the guard calls this instead of throwing.
   * Useful for logging or returning a custom error shape.
   */
  onMissingTenant?: (slug: string) => void | Promise<void>;
}

export interface HuniAsyncOptions<TConn = unknown>
  extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (...args: unknown[]) => HuniOptions<TConn> | Promise<HuniOptions<TConn>>;
  inject?: (string | symbol | Type<unknown>)[];
}
