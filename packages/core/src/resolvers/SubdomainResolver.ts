import type { Resolver } from '../types.js';

interface RequestLike {
  hostname?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface SubdomainResolverOptions {
  /** Subdomain labels treated as "no tenant" — returns null for these. Default: `['www']` */
  ignoredSubdomains?: string[];
}

/**
 * Resolves the tenant from the leftmost subdomain of the request hostname.
 *
 * `acme.myapp.com` → `"acme"`
 * `www.myapp.com`  → `null` (ignored by default)
 */
export class SubdomainResolver implements Resolver {
  private readonly ignored: Set<string>;

  constructor(options: SubdomainResolverOptions = {}) {
    this.ignored = new Set(options.ignoredSubdomains ?? ['www']);
  }

  resolve(req: RequestLike): string | null {
    const host =
      req.hostname ??
      (typeof req.headers?.host === 'string' ? req.headers.host : undefined) ??
      '';

    const hostname = host.split(':')[0] ?? '';
    const parts = hostname.split('.');

    if (parts.length < 3) return null;

    const sub = parts[0] ?? null;
    if (sub === null || this.ignored.has(sub)) return null;
    return sub;
  }
}
