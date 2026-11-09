import type { Resolver } from "../types.js";

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
 * `acme.localhost` → `"acme"` (`localhost` acts as a TLD for local development)
 * `www.myapp.com`  → `null` (ignored by default)
 * `127.0.0.1`      → `null` (IP literals never carry a tenant)
 *
 * Matching is case-insensitive; the returned slug is lower-cased.
 */
export class SubdomainResolver implements Resolver {
  private readonly ignored: Set<string>;

  constructor(options: SubdomainResolverOptions = {}) {
    this.ignored = new Set((options.ignoredSubdomains ?? ["www"]).map((s) => s.toLowerCase()));
  }

  resolve(req: RequestLike): string | null {
    const host =
      req.hostname ?? (typeof req.headers?.host === "string" ? req.headers.host : undefined) ?? "";

    // IPv6 literals are bracketed in the Host header (`[::1]:3000`).
    if (host.startsWith("[")) return null;

    const hostname = (host.split(":")[0] ?? "").toLowerCase();
    if (isIPv4(hostname)) return null;

    const parts = hostname.split(".");
    // `<tenant>.localhost` has two labels; real domains need `<tenant>.<domain>.<tld>`.
    const minLabels = parts[parts.length - 1] === "localhost" ? 2 : 3;
    if (parts.length < minLabels) return null;

    const sub = parts[0];
    if (sub === undefined || sub === "" || this.ignored.has(sub)) return null;
    return sub;
  }
}

function isIPv4(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}
