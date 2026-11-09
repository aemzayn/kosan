/**
 * Creates three tenants spread over two regions and seeds an order in each.
 * Safe to re-run: existing tenants are skipped, and leftovers of a crashed
 * run (rows still in status `provisioning`) are cleaned up and recreated.
 *
 *   pnpm provision
 */
import { randomBytes } from "node:crypto";
import { REGIONS, type RegionName } from "./config.js";
import { closeAdminConnections } from "./provisioning.js";
import { closeRegistry, registry } from "./registry.js";

const TENANTS: Array<{ slug: string; region: RegionName; product: string }> = [
  { slug: "acme", region: "eu", product: "Anvil" },
  { slug: "globex", region: "us", product: "Doomsday device" },
  { slug: "initech", region: "eu", product: "TPS report cover" },
];

try {
  const existing = new Map((await registry.listTenants()).map((t) => [t.slug, t]));

  for (const { slug, region, product } of TENANTS) {
    const found = existing.get(slug);
    if (found?.status === "provisioning") {
      // A previous run died mid-provisioning: drop its half-created DB and retry.
      console.log(`~ ${slug}: cleaning up an unfinished provisioning attempt`);
      await registry.deleteTenant(found.id);
    } else if (found !== undefined) {
      console.log(`- ${slug}: already exists, skipping`);
      continue;
    }

    const { host, port } = REGIONS[region];
    await registry.createTenant({
      slug,
      host,
      port,
      dbName: `tenant_${slug}`,
      user: `tenant_${slug}`,
      // A unique password per tenant; stored encrypted by the registry's cipher.
      password: randomBytes(18).toString("base64url"),
      meta: { region },
    });

    // Seed through Kosan exactly like a request would.
    const { connection } = await registry.resolveBySlug(slug);
    await connection.model("Order").create({ product, total: "99.00" });

    console.log(`+ ${slug}: created in ${REGIONS[region].label} (${host}:${port})`);
  }

  console.log("\nTenants:");
  for (const t of await registry.listTenants()) {
    console.log(
      `  ${t.slug.padEnd(8)} region=${String(t.meta?.region)} ${t.host}:${t.port}/${t.dbName}`,
    );
  }
} finally {
  await closeRegistry();
  await closeAdminConnections();
}
