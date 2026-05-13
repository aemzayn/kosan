/**
 * Run once after `docker-compose up` to create the two demo tenants.
 *
 *   pnpm provision
 */
import { registry } from "./registry.js";

const tenants = [
  {
    slug: "alpha",
    host: "localhost",
    port: 5433,
    dbName: "alpha_db",
    user: "alpha_user",
    password: "alpha_pass",
    meta: { plan: "pro", company: "Alpha Corp" },
  },
  {
    slug: "beta",
    host: "localhost",
    port: 5434,
    dbName: "beta_db",
    user: "beta_user",
    password: "beta_pass",
    meta: { plan: "starter", company: "Beta Inc" },
  },
];

for (const input of tenants) {
  const existing = await registry
    .listTenants()
    .then((all) => all.find((t) => t.slug === input.slug));

  if (existing !== undefined) {
    console.log(`[skip] tenant "${input.slug}" already exists`);
    continue;
  }

  await registry.createTenant(input);
  console.log(`[ok] created tenant "${input.slug}"`);
}

await registry.shutdown();
process.exit(0);
