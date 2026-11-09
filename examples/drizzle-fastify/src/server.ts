import { SubdomainResolver, useTenant } from "@kosan/core";
import { useDrizzle } from "@kosan/drizzle";
import tenantPlugin from "@kosan/fastify";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { type TenantDb, registry } from "./registry.js";
import { posts } from "./tenant-schema.js";

const fastify = Fastify({ logger: false });

// ---------------------------------------------------------------------------
// Tenant resolution — acme.localhost:3000, globex.localhost:3000, etc.
// ---------------------------------------------------------------------------

await fastify.register(tenantPlugin, {
  registry,
  resolver: new SubdomainResolver(),
  onMissingTenant: (_req, reply) => {
    void reply.status(400).send({
      error: "No tenant subdomain found. Use <slug>.localhost:3000.",
    });
  },
});

// ---------------------------------------------------------------------------
// Routes — useDrizzle() is available inside every handler
// ---------------------------------------------------------------------------

fastify.get("/", () => {
  const { tenant } = useTenant();
  return {
    message: `Hello from tenant "${tenant.slug}"!`,
    plan: tenant.meta?.plan,
    dbName: tenant.dbName,
  };
});

fastify.get("/posts", async () => {
  const db = useDrizzle<TenantDb>();
  return db.select().from(posts);
});

fastify.post("/posts", async (request) => {
  const db = useDrizzle<TenantDb>();
  const body = request.body as { title: string; body: string };
  const [post] = await db.insert(posts).values(body).returning();
  return post;
});

fastify.delete("/posts/:id", async (request) => {
  const db = useDrizzle<TenantDb>();
  const { id } = request.params as { id: string };
  const [deleted] = await db.delete(posts).where(eq(posts.id, id)).returning();
  return { deleted: deleted ?? null };
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

fastify.get("/health", () => ({
  status: "ok",
  cacheSize: registry.cache.size,
  cacheStats: registry.cache.stats(),
}));

const PORT = Number(process.env.PORT ?? 3000);
await fastify.listen({ port: PORT, host: "0.0.0.0" });
console.log(`Server running on http://localhost:${PORT}`);
console.log('Try: curl -H "Host: acme.localhost" http://localhost:3000/posts');
