import { SubdomainResolver, getHealthPayload, useTenant } from "@kosan/core";
import { tenantMiddleware } from "@kosan/express";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Sequelize } from "sequelize";
import { asyncRoute } from "./asyncRoute.js";
import { REGIONS, isRegion } from "./config.js";
import { registry } from "./registry.js";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Health — registered before the tenant middleware, so it needs no subdomain.
// Shows which tenants currently hold an open connection.
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json(getHealthPayload(registry));
});

// ---------------------------------------------------------------------------
// Tenant resolution: acme.localhost:3000 → tenant "acme", wherever it lives.
// ---------------------------------------------------------------------------

app.use(
  tenantMiddleware({
    registry,
    resolver: new SubdomainResolver(),
    onMissingTenant: (_req, res) => {
      res
        .status(400)
        .json({ error: "No tenant in the hostname. Use <tenant>.localhost, e.g. acme.localhost" });
    },
  }),
);

/** Where is this tenant's data? The handler code is identical for every region. */
app.get("/", (_req: Request, res: Response) => {
  const { tenant } = useTenant<Sequelize>();
  const region = tenant.meta?.region;
  res.json({
    tenant: tenant.slug,
    region,
    regionLabel: isRegion(region) ? REGIONS[region].label : "unknown",
    database: `${tenant.host}:${tenant.port}/${tenant.dbName}`,
  });
});

app.get(
  "/orders",
  asyncRoute(async (_req: Request, res: Response) => {
    const { connection } = useTenant<Sequelize>();
    res.json(await connection.model("Order").findAll({ order: [["product", "ASC"]] }));
  }),
);

app.post(
  "/orders",
  asyncRoute(async (req: Request, res: Response) => {
    const { connection } = useTenant<Sequelize>();
    const body: unknown = req.body;
    if (typeof body !== "object" || body === null || !("product" in body) || !("total" in body)) {
      res.status(400).json({ error: 'Expected JSON { "product": string, "total": number }' });
      return;
    }
    const order = await connection
      .model("Order")
      .create({ product: body.product, total: body.total });
    res.status(201).json(order);
  }),
);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`multi-region example on http://localhost:${PORT}`);
  console.log(`  curl http://acme.localhost:${PORT}/      # EU tenant`);
  console.log(`  curl http://globex.localhost:${PORT}/    # US tenant`);
});
