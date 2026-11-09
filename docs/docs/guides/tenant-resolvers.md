---
---

# Tenant Resolvers

A resolver extracts the tenant identifier from an incoming HTTP request. Kosan ships three built-in resolvers and accepts any plain function.

---

## Built-in resolvers

### SubdomainResolver

Reads the first subdomain label from the `Host` header.

```ts
import { SubdomainResolver } from '@kosan/core';

// acme.myapp.com       → "acme"
// www.myapp.com        → null  (ignored by default)
// api.myapp.com        → null  (ignored by default)
// myapp.com            → null  (no subdomain)
const resolver = new SubdomainResolver({
  ignoredSubdomains: ['www', 'api', 'app', 'staging'], // default: ['www']
});
```

#### How it works

The resolver parses `req.headers.host`, splits on `.`, and takes the first segment. If the segment is in `ignoredSubdomains` or the host has fewer than three parts (no subdomain), it returns `null`.

#### Wildcard DNS setup

You need a wildcard DNS record pointing all subdomains to your server:

```
*.myapp.com  →  your server IP
```

Local development with `*.localhost` works in most browsers without DNS changes.

---

### HeaderResolver

Reads a custom HTTP header.

```ts
import { HeaderResolver } from '@kosan/core';

// Request: X-Tenant-ID: acme
const resolver = new HeaderResolver('X-Tenant-ID');
```

Useful for internal APIs, machine-to-machine calls, or when you control the client.

---

### PathResolver

Extracts a URL path segment by zero-based index.

```ts
import { PathResolver } from '@kosan/core';

// /acme/orders        → "acme"  (segment 0)
// /api/v1/acme/data   → "acme"  (segment 2)
const resolver = new PathResolver({ segment: 0 });
```

---

## JwtResolver

Reads the tenant from a claim in a **verified** JWT. Kosan doesn't bundle a JWT library: you pass a `verify` function wrapping the one you already use. It must throw for invalid or expired tokens.

```ts
import { JwtResolver } from '@kosan/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL('https://auth.example.com/.well-known/jwks.json'));

const resolver = new JwtResolver({
  verify: async (token) => (await jwtVerify(token, jwks)).payload,
  claim: 'tenant', // Authorization: Bearer <jwt> with { "tenant": "acme" } → "acme"
});
```

Options:

| Option | Default | Description |
|---|---|---|
| `verify(token)` | required | Returns the verified payload; throws for a bad token |
| `claim` | required | Claim name, or `(payload) => value` for nested claims |
| `header` | `authorization` | `authorization` is read as `Bearer <token>`; any other header as the raw token |

The resolver returns `null` (no tenant) when the token is missing, fails verification, or lacks a non-empty string claim. An unverified token can never select a tenant.

```ts
// Nested claim: { "org": { "slug": "acme" } }
new JwtResolver({
  verify,
  claim: (payload) => (payload.org as { slug?: string } | undefined)?.slug,
});
```

---

## Custom resolvers

Pass any async function anywhere a resolver is accepted:

```ts
app.use(tenantMiddleware({
  registry,
  resolver: async (req) => req.session?.tenantSlug ?? null,
}));
```

Or implement the `Resolver` interface for reusability:

```ts
import type { Resolver } from '@kosan/core';

export class SessionResolver implements Resolver {
  resolve(req: { session?: { tenantSlug?: string } }): string | null {
    return req.session?.tenantSlug ?? null;
  }
}
```

---

## Resolver decision matrix

| Use case | Recommended resolver |
|---|---|
| SaaS app, each tenant has a subdomain | `SubdomainResolver` |
| Internal API, client sends a tenant header | `HeaderResolver` |
| Shared domain, tenant in URL (`/tenant/…`) | `PathResolver` |
| Authentication via JWT | `JwtResolver` |
| Session-based tenancy | Custom async function reading `req.session` |
| Multi-region with tenant in host | `SubdomainResolver` + custom fallback |

---

## Chaining multiple resolvers

Try multiple strategies in order:

```ts
app.use(tenantMiddleware({
  registry,
  resolver: async (req) => {
    // 1. Try header (for API clients)
    const header = req.headers['x-tenant-id'];
    if (typeof header === 'string' && header) return header;

    // 2. Fall back to subdomain
    const host = req.headers.host ?? '';
    const sub = host.split('.')[0];
    if (sub && sub !== 'www' && host.includes('.')) return sub;

    return null;
  },
}));
```

---

## Returning null vs. throwing

- Return `null` → triggers `onMissingTenant` (defaults to 400)
- Throw an error → middleware catches it and responds 500
- Return an empty string `""` → treated the same as `null`

Always return `null` for "no tenant found" cases. Reserve throwing for unrecoverable internal errors.
