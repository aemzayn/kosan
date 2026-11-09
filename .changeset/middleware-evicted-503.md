---
"@kosan/express": patch
"@kosan/fastify": patch
"@kosan/koa": patch
"@kosan/nestjs": patch
---

Respond `503` with `Retry-After: 1` (instead of `500`) when a tenant's connection was cancelled mid-request because the tenant changed at that moment.
