import type { Resolver } from "../types.js";

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Resolves the tenant from a request header value.
 *
 * Example: `new HeaderResolver('X-Tenant-ID')` reads the `x-tenant-id` header.
 */
export class HeaderResolver implements Resolver {
  private readonly headerName: string;

  constructor(header: string) {
    this.headerName = header.toLowerCase();
  }

  resolve(req: RequestLike): string | null {
    const value = req.headers?.[this.headerName];
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
  }
}
