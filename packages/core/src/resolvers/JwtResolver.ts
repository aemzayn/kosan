import type { Resolver } from "../types.js";

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
}

export interface JwtResolverOptions {
  /**
   * Verifies the token's signature and expiry and returns its payload; must
   * throw (or reject) for an invalid token. Kosan ships no JWT library — wrap
   * the one you already use, e.g. `jose`:
   *
   * ```ts
   * verify: async (token) => (await jwtVerify(token, key)).payload
   * ```
   */
  verify: (token: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /**
   * The claim holding the tenant slug, or a function that picks it from the
   * verified payload (for nested claims). Non-string / empty values → no tenant.
   */
  claim: string | ((payload: Record<string, unknown>) => unknown);
  /**
   * Header carrying the token. Default: `authorization`, read as
   * `Bearer <token>`. Any other header is read as the raw token.
   */
  header?: string;
}

/**
 * Resolves the tenant from a claim in a verified JWT.
 *
 * Returns `null` (no tenant) when the token is missing, fails verification,
 * or lacks the claim, so an unverified token can never select a tenant.
 */
export class JwtResolver implements Resolver {
  private readonly verify: JwtResolverOptions["verify"];
  private readonly claim: JwtResolverOptions["claim"];
  private readonly header: string;

  constructor(options: JwtResolverOptions) {
    this.verify = options.verify;
    this.claim = options.claim;
    this.header = (options.header ?? "authorization").toLowerCase();
  }

  async resolve(req: RequestLike): Promise<string | null> {
    const token = this.extractToken(req);
    if (token === null) return null;

    let payload: Record<string, unknown>;
    try {
      payload = await this.verify(token);
    } catch {
      return null;
    }

    const value = typeof this.claim === "string" ? payload[this.claim] : this.claim(payload);
    return typeof value === "string" && value !== "" ? value : null;
  }

  private extractToken(req: RequestLike): string | null {
    const raw = req.headers?.[this.header];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === "") return null;
    if (this.header !== "authorization") return value;

    const match = /^Bearer\s+(.+)$/i.exec(value);
    return match?.[1] ?? null;
  }
}
