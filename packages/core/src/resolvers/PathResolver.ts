import type { Resolver } from "../types.js";

interface RequestLike {
  path?: string;
  url?: string;
}

/**
 * Resolves the tenant from a URL path segment.
 *
 * Example: `new PathResolver({ segment: 0 })` on `/acme/orders` → `"acme"`.
 */
export class PathResolver implements Resolver {
  private readonly segment: number;

  constructor(options: { segment: number } = { segment: 0 }) {
    this.segment = options.segment;
  }

  resolve(req: RequestLike): string | null {
    const raw = req.path ?? req.url ?? "";
    // Strip query string before splitting.
    const pathname = raw.split("?")[0] ?? "";
    const segments = pathname.split("/").filter(Boolean);
    return segments[this.segment] ?? null;
  }
}
