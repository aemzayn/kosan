import { SubdomainResolver, useTenant } from "@kosan/core";
import { tenantMiddleware } from "@kosan/koa";
import { usePrisma } from "@kosan/prisma";
import type { PrismaClient } from "@prisma/client";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import Router from "koa-router";
import { registry } from "./registry.js";

const app = new Koa();
const router = new Router();

app.use(bodyParser());

// ---------------------------------------------------------------------------
// Tenant resolution — acme.localhost:3000, globex.localhost:3000, etc.
// ---------------------------------------------------------------------------

app.use(
  tenantMiddleware({
    registry,
    resolver: new SubdomainResolver(),
    onMissingTenant: async (ctx) => {
      ctx.status = 400;
      ctx.body = { error: "No tenant subdomain found. Use <slug>.localhost:3000." };
    },
  }),
);

// ---------------------------------------------------------------------------
// Routes — usePrisma() is available inside every handler
// ---------------------------------------------------------------------------

router.get("/", (ctx) => {
  const { tenant } = useTenant();
  ctx.body = {
    message: `Hello from tenant "${tenant.slug}"!`,
    plan: tenant.meta?.plan,
    dbName: tenant.dbName,
  };
});

router.get("/posts", async (ctx) => {
  const prisma = usePrisma<PrismaClient>();
  const posts = await prisma.$queryRaw<
    { id: string; title: string; body: string }[]
  >`SELECT * FROM posts`;
  ctx.body = posts;
});

router.post("/posts", async (ctx) => {
  const prisma = usePrisma<PrismaClient>();
  const { title, body } = ctx.request.body as { title: string; body: string };
  const [post] = await prisma.$queryRaw<
    { id: string; title: string; body: string }[]
  >`INSERT INTO posts (title, body) VALUES (${title}, ${body}) RETURNING *`;
  ctx.status = 201;
  ctx.body = post;
});

router.delete("/posts/:id", async (ctx) => {
  const prisma = usePrisma<PrismaClient>();
  const { id } = ctx.params;
  await prisma.$executeRaw`DELETE FROM posts WHERE id = ${id}::uuid`;
  ctx.body = { deleted: id };
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

router.get("/health", (ctx) => {
  ctx.body = {
    status: "ok",
    cacheSize: registry.cache.size,
    cacheStats: registry.cache.stats(),
  };
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Try: curl -H "Host: acme.localhost" http://localhost:3000/');
});
