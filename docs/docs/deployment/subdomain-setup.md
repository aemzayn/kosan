---
---

# Subdomain Setup

When using `SubdomainResolver`, each tenant gets their own subdomain (`acme.myapp.com`). This guide covers DNS, reverse proxy, TLS, and local development configuration.

---

## DNS

Add a wildcard A record pointing all subdomains to your server:

```
*.myapp.com  →  203.0.113.42   (your server IP)
myapp.com    →  203.0.113.42
```

With most DNS providers (Cloudflare, Route 53, etc.) a wildcard `*` record covers one level of subdomain — `acme.myapp.com` matches but `team.acme.myapp.com` does not.

---

## Nginx reverse proxy

```nginx [/etc/nginx/sites-available/myapp]
# Catch all subdomains
server {
    listen 443 ssl;
    server_name *.myapp.com;

    ssl_certificate     /etc/letsencrypt/live/myapp.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myapp.com/privkey.pem;

    # Forward Host header so SubdomainResolver can read it
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    location / {
        proxy_pass http://localhost:3000;
    }
}

# Redirect bare domain to www (or your landing page)
server {
    listen 443 ssl;
    server_name myapp.com;
    return 301 https://www.myapp.com$request_uri;
}
```

---

## TLS with Let's Encrypt (wildcard)

Wildcard certificates require a DNS-01 challenge:

```bash
# Install certbot with a DNS plugin (example: Cloudflare)
pip install certbot-dns-cloudflare

# Request wildcard cert
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials ~/.secrets/cloudflare.ini \
  -d myapp.com \
  -d "*.myapp.com"
```

Configure Certbot to renew automatically:

```bash
echo "0 0,12 * * * root certbot renew --quiet" >> /etc/cron.d/certbot
```

---

## Caddy reverse proxy (automatic HTTPS)

[Caddy](https://caddyserver.com) handles TLS automatically, including wildcard certs with DNS challenge:

```caddy [Caddyfile]
*.myapp.com, myapp.com {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }

    reverse_proxy localhost:3000 {
        header_up Host {host}
    }
}
```

---

## Express: trust proxy headers

When running behind Nginx or Caddy, tell Express to trust the `X-Forwarded-*` headers so `req.hostname` resolves correctly:

```ts
const app = express();
app.set('trust proxy', 1);
```

`SubdomainResolver` reads `req.headers.host` directly, so this is not strictly required for Kosan — but it is required for `req.hostname` and `req.protocol` to work correctly in your handlers.

---

## Local development

Modern browsers support `*.localhost` subdomains without DNS configuration:

```
acme.localhost:3000   → resolves to 127.0.0.1
globex.localhost:3000 → resolves to 127.0.0.1
```

Start your Express/Fastify server on port 3000 and navigate to `http://acme.localhost:3000`.

If your OS does not resolve `*.localhost` automatically (older macOS, some Linux distros), add entries to `/etc/hosts`:

```
127.0.0.1  acme.localhost
127.0.0.1  globex.localhost
127.0.0.1  initech.localhost
```

Or use a tool like [dnsmasq](https://thekelleys.org.uk/dnsmasq/doc.html) to wildcard-resolve `*.localhost`:

```
# /etc/dnsmasq.d/local.conf
address=/.localhost/127.0.0.1
```

---

## SubdomainResolver configuration

```ts
import { SubdomainResolver } from '@kosan/core';

const resolver = new SubdomainResolver({
  // These subdomains are treated as "no tenant" and return null
  ignoredSubdomains: ['www', 'api', 'app', 'staging', 'dev'],
});
```

Hosts that match an ignored subdomain or have no subdomain trigger `onMissingTenant` (default: 400 response). Configure that to redirect to your marketing page:

```ts
app.use(tenantMiddleware({
  registry,
  resolver,
  onMissingTenant: (_req, res) => {
    res.redirect('https://www.myapp.com');
  },
}));
```

---

## Multi-region tenants

For tenants hosted in different regions, use the same subdomain scheme but point different subdomains to different servers — or use GeoDNS:

```
acme.myapp.com     → us-east server   (tenant DB: us-east-1)
europeancorp.myapp.com → eu-west server  (tenant DB: eu-west-1)
```

The `host` field in the tenant record points to the correct regional database, regardless of which server is resolving the request.
