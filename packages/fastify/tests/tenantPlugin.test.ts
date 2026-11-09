import {
  TenantNotActiveError,
  TenantNotFoundError,
  getCurrentTenant,
  useTenant,
} from "@kosan/core";
import type { TenantConfig, TenantRegistry } from "@kosan/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import tenantPlugin from "../src/tenantPlugin.js";

// ---------------------------------------------------------------------------
// Registry stub
// ---------------------------------------------------------------------------

const ACTIVE_TENANT: TenantConfig = {
  id: "tenant-1",
  slug: "acme",
  host: "localhost",
  port: 5432,
  dbName: "acme_db",
  user: "u",
  password: "p",
  status: "active",
};

function makeRegistry(
  behaviour: "found" | "not-found" | "suspended" | "error" = "found",
): TenantRegistry {
  return {
    resolveBySlug: vi.fn(async (slug: string) => {
      if (behaviour === "not-found") throw new TenantNotFoundError(slug);
      if (behaviour === "suspended") throw new TenantNotActiveError(slug, "suspended");
      if (behaviour === "error") throw new Error("registry exploded");
      return { tenant: ACTIVE_TENANT, connection: {}, models: { Order: {} } };
    }),
  } as unknown as TenantRegistry;
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp(
  registryBehaviour: Parameters<typeof makeRegistry>[0] = "found",
  resolverSlug: string | null = "acme",
) {
  const fastify = Fastify({ logger: false });

  await fastify.register(tenantPlugin, {
    registry: makeRegistry(registryBehaviour),
    resolver: { resolve: () => resolverSlug },
  });

  fastify.get("/test", async () => {
    const ctx = useTenant();
    return { slug: ctx.tenant.slug };
  });

  await fastify.ready();
  return fastify;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("tenantPlugin", () => {
  describe("happy path", () => {
    it("sets the tenant context and the route handler can call useTenant()", async () => {
      const app = await buildApp("found", "acme");
      const res = await app.inject({ method: "GET", url: "/test" });
      expect(res.statusCode).toBe(200);
      expect(res.json().slug).toBe("acme");
      await app.close();
    });

    it("makes useTenant() available after async awaits in the handler", async () => {
      const app = Fastify({ logger: false });
      await app.register(tenantPlugin, {
        registry: makeRegistry("found"),
        resolver: { resolve: () => "acme" },
      });
      app.get("/async", async () => {
        await Promise.resolve();
        return { slug: useTenant().tenant.slug };
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/async" });
      expect(res.statusCode).toBe(200);
      expect(res.json().slug).toBe("acme");
      await app.close();
    });
  });

  describe("missing tenant identifier", () => {
    it("returns 400 when resolver returns null", async () => {
      const app = await buildApp("found", null);
      const res = await app.inject({ method: "GET", url: "/test" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/Tenant identifier missing/);
      await app.close();
    });

    it("calls onMissingTenant when provided", async () => {
      const app = Fastify({ logger: false });
      const onMissing = vi.fn(
        async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => void } }) => {
          reply.status(401).send({ custom: "no tenant" });
        },
      );

      await app.register(tenantPlugin, {
        registry: makeRegistry("found"),
        resolver: { resolve: () => null },
        onMissingTenant: onMissing as never,
      });
      app.get("/x", async () => ({}));
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/x" });
      expect(res.statusCode).toBe(401);
      expect(onMissing).toHaveBeenCalledOnce();
      await app.close();
    });
  });

  describe("tenant errors", () => {
    it("returns 404 for unknown tenant", async () => {
      const app = await buildApp("not-found", "acme");
      const res = await app.inject({ method: "GET", url: "/test" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatch(/Tenant not found/);
      await app.close();
    });

    it("returns 403 for suspended tenant", async () => {
      const app = await buildApp("suspended", "acme");
      const res = await app.inject({ method: "GET", url: "/test" });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/not active/);
      await app.close();
    });

    it("re-throws unexpected errors (caught by Fastify error handler)", async () => {
      const app = await buildApp("error", "acme");
      const res = await app.inject({ method: "GET", url: "/test" });
      expect(res.statusCode).toBe(500);
      await app.close();
    });
  });

  describe("resolver types", () => {
    it("accepts a plain function resolver", async () => {
      const app = Fastify({ logger: false });
      await app.register(tenantPlugin, {
        registry: makeRegistry("found"),
        resolver: (_req) => "acme",
      });
      app.get("/fn", async () => ({ slug: useTenant().tenant.slug }));
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/fn" });
      expect(res.statusCode).toBe(200);
      expect(res.json().slug).toBe("acme");
      await app.close();
    });

    it("accepts an async function resolver", async () => {
      const app = Fastify({ logger: false });
      await app.register(tenantPlugin, {
        registry: makeRegistry("found"),
        resolver: async () => {
          await Promise.resolve();
          return "acme";
        },
      });
      app.get("/async-fn", async () => ({ slug: useTenant().tenant.slug }));
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/async-fn" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("context isolation", () => {
    it("isolates tenant context between concurrent requests", async () => {
      const app = Fastify({ logger: false });

      await app.register(tenantPlugin, {
        registry: {
          resolveBySlug: vi.fn(async (slug: string) => ({
            tenant: { ...ACTIVE_TENANT, slug },
            connection: {},
            models: {},
          })),
        } as unknown as TenantRegistry,
        resolver: (req) => (req.query as Record<string, string>).slug ?? null,
      });

      app.get("/ctx", async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { slug: getCurrentTenant()?.slug };
      });
      await app.ready();

      const [a, b] = await Promise.all([
        app.inject({ method: "GET", url: "/ctx?slug=alpha" }),
        app.inject({ method: "GET", url: "/ctx?slug=beta" }),
      ]);

      expect(a.json().slug).toBe("alpha");
      expect(b.json().slug).toBe("beta");
      await app.close();
    });
  });
});
