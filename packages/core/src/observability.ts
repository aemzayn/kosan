import { getCurrentTenant } from './TenantContext.js';
import type { TenantRegistry } from './TenantRegistry.js';

export interface TenantLogContext {
  tenantId: string;
  tenantSlug: string;
}

/** Returns structured log fields for the current tenant from AsyncLocalStorage.
 *  Returns an empty object when called outside a tenant request context. */
export function getTenantLogContext(): TenantLogContext | Record<string, never> {
  const tenant = getCurrentTenant();
  if (tenant === undefined) return {};
  return { tenantId: tenant.id, tenantSlug: tenant.slug };
}

export interface HealthPayload {
  cacheSize: number;
  cacheMaxSize: number;
  tenantCount: number;
  entries: { tenantId: string; tenantSlug: string; lastUsed: number; idleMs: number }[];
}

/** Builds a health/status payload from the registry's current cache state. */
export function getHealthPayload(registry: TenantRegistry): HealthPayload {
  const stats = registry.getStats();
  return {
    cacheSize: stats.cacheSize,
    cacheMaxSize: stats.cacheMaxSize,
    tenantCount: stats.cacheSize,
    entries: stats.entries,
  };
}
