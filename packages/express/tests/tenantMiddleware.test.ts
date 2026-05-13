import {
  TenantNotActiveError,
  TenantNotFoundError,
  getCurrentTenant,
  useTenant,
} from "@kosan/core";
import type { TenantConfig, TenantRegistry } from "@kosan/core";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tenantMiddleware } from "../src/tenantMiddleware.js";

// ---------------------------------------------------------------------------
// Minimal registry stub
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
    resolveBySlug: vi.fn(async (_slug: string) => {
      if (behaviour === "not-found") throw new TenantNotFoundError(_slug);
      if (behaviour === "suspended") throw new TenantNotActiveError(_slug, "suspended");
      if (behaviour === "error") throw new Error("DB exploded");
      return { tenant: ACTIVE_TENANT, connection: {}, models: { Order: {} } };
    }),
  } as unknown as TenantRegistry;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(
  registryBehaviour: Parameters<typeof makeRegistry>[0] = "found",
  resolverSlug: string | null = "acme",
) {
  const app = express();
  const registry = makeRegistry(registryBehaviour);

  app.use(
    tenantMiddleware({
      registry,
      resolver: { resolve: () => resolverSlug },
    }),
  );

  app.get("/test", (_req: Request, res: Response) => {
    const ctx = useTenant();
    res.json({ slug: ctx.tenant.slug });
  });

  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      // Must have 4 params for Express to treat this as error handler.
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: String(err) });
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("tenantMiddleware", () => {
  describe("happy path", () => {
    it("sets the tenant context and passes to the next handler", async () => {
      const res = await request(buildApp("found", "acme")).get("/test");
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe("acme");
    });

    it("makes useTenant() available inside async handlers", async () => {
      const app = express();
      const registry = makeRegistry("found");
      app.use(tenantMiddleware({ registry, resolver: { resolve: () => "acme" } }));
      app.get("/async", async (_req, res) => {
        await Promise.resolve(); // yield to event loop
        const ctx = useTenant();
        res.json({ slug: ctx.tenant.slug });
      });

      const res = await request(app).get("/async");
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe("acme");
    });
  });

  describe("missing tenant identifier", () => {
    it("returns 400 when resolver returns null", async () => {
      const res = await request(buildApp("found", null)).get("/test");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Tenant identifier missing/);
    });

    it("calls onMissingTenant when provided", async () => {
      const app = express();
      const registry = makeRegistry("found");
      const onMissing = vi.fn((_req: Request, res: Response) => {
        res.status(401).json({ custom: "no tenant" });
      });

      app.use(
        tenantMiddleware({
          registry,
          resolver: { resolve: () => null },
          onMissingTenant: onMissing,
        }),
      );
      app.get("/x", (_req, res) => res.json({}));

      const res = await request(app).get("/x");
      expect(res.status).toBe(401);
      expect(onMissing).toHaveBeenCalledOnce();
    });
  });

  describe("tenant errors", () => {
    it("returns 404 for unknown tenant", async () => {
      const res = await request(buildApp("not-found", "acme")).get("/test");
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Tenant not found/);
    });

    it("returns 403 for suspended tenant", async () => {
      const res = await request(buildApp("suspended", "acme")).get("/test");
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not active/);
    });

    it("forwards unexpected errors to the next error handler", async () => {
      const res = await request(buildApp("error", "acme")).get("/test");
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/DB exploded/);
    });
  });

  describe("resolver types", () => {
    it("accepts a plain function resolver", async () => {
      const app = express();
      const registry = makeRegistry("found");
      app.use(
        tenantMiddleware({
          registry,
          resolver: (_req) => "acme",
        }),
      );
      app.get("/fn", (_req, res) => res.json({ slug: useTenant().tenant.slug }));

      const res = await request(app).get("/fn");
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe("acme");
    });

    it("accepts an async function resolver", async () => {
      const app = express();
      const registry = makeRegistry("found");
      app.use(
        tenantMiddleware({
          registry,
          resolver: async (_req) => {
            await Promise.resolve();
            return "acme";
          },
        }),
      );
      app.get("/async-fn", (_req, res) => res.json({ slug: useTenant().tenant.slug }));

      const res = await request(app).get("/async-fn");
      expect(res.status).toBe(200);
    });
  });

  describe("context isolation", () => {
    it("isolates tenant context between concurrent requests", async () => {
      const app = express();

      app.use(
        tenantMiddleware({
          registry: {
            resolveBySlug: vi.fn(async (slug: string) => ({
              tenant: { ...ACTIVE_TENANT, slug },
              connection: {},
              models: {},
            })),
          } as unknown as TenantRegistry,
          resolver: { resolve: (req) => ((req as Request).query.slug as string) ?? null },
        }),
      );

      app.get("/ctx", async (_req, res) => {
        await new Promise((r) => setTimeout(r, 10));
        res.json({ slug: getCurrentTenant()?.slug });
      });

      const [a, b] = await Promise.all([
        request(app).get("/ctx?slug=alpha"),
        request(app).get("/ctx?slug=beta"),
      ]);

      expect(a.body.slug).toBe("alpha");
      expect(b.body.slug).toBe("beta");
    });
  });
});
