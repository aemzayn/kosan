---
sidebar_position: 1
---

# Tenant Resolvers

A resolver extracts the tenant identifier from an incoming HTTP request. Huni ships three built-in resolvers and accepts any plain function.

---

## Built-in resolvers

### SubdomainResolver

Reads the first subdomain label from the `Host` header.

```ts
import { SubdomainResolver } from '@huni/core';

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
import { HeaderResolver } from '@huni/core';

// Request: X-Tenant-ID: acme
const resolver = new HeaderResolver('X-Tenant-ID');
```

Useful for internal APIs, machine-to-machine calls, or when you control the client.

---

### PathResolver

Extracts a URL path segment by zero-based index.

```ts
import { PathResolver } from '@huni/core';

// /acme/orders        → "acme"  (segment 0)
// /api/v1/acme/data   → "acme"  (segment 2)
const resolver = new PathResolver({ segment: 0 });
```

---

## Custom resolvers

Pass any async function anywhere a resolver is accepted:

```ts
app.use(tenantMiddleware({
  registry,
  resolver: async (req) => {
    // Example: extract slug from a JWT Bearer token
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    const { tenantSlug } = await verifyJwt(auth.slice(7));
    return tenantSlug ?? null;
  },
}));
```

Or implement the `Resolver` interface for reusability:

```ts
import type { Resolver } from '@huni/core';
import type { IncomingMessage } from 'http';

export class JwtResolver implements Resolver {
  constructor(private readonly secret: string) {}

  async resolve(req: IncomingMessage): Promise<string | null> {
    const auth = (req as Record<string, unknown>).headers?.['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
    try {
      const payload = await verifyJwt(auth.slice(7), this.secret);
      return payload.tenantSlug ?? null;
    } catch {
      return null;
    }
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
| Authentication via JWT | Custom async function |
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
