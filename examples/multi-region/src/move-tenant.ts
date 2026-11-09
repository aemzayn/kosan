/**
 * Moves a tenant's database to another region while the server keeps running.
 *
 *   pnpm move-tenant globex eu
 *
 * Steps:
 *   1. suspend the tenant, so no writes are lost during the copy (requests get 403)
 *   2. create the database + role in the target region
 *   3. copy the data
 *   4. point the tenant row at the new host and reactivate it
 *   5. drop the old database
 *
 * The running server needs no restart. Within its `tenantTtlMs` it re-reads
 * the tenant row, sees that the host changed, closes the old connection and
 * connects to the new region.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { Sequelize } from "sequelize";
import { cipher } from "./cipher.js";
import { REGIONS, isRegion, regionOf } from "./config.js";
import { OrderModel } from "./models/order.js";
import { closeAdminConnections, createTenantDatabase, dropTenantDatabase } from "./provisioning.js";
import { closeRegistry, registry } from "./registry.js";

const [slug, target] = process.argv.slice(2);
if (slug === undefined || !isRegion(target)) {
  console.error(`Usage: pnpm move-tenant <slug> <${Object.keys(REGIONS).join("|")}>`);
  process.exit(1);
}

/** Longer than the server's tenantTtlMs (registry.ts), so it has seen the suspension. */
const SERVER_TTL_GRACE_MS = 2_500;

function connect(
  host: string,
  port: number,
  spec: { dbName: string; user: string; password: string },
) {
  return new Sequelize({
    dialect: "postgres",
    host,
    port,
    database: spec.dbName,
    username: spec.user,
    password: spec.password,
    logging: false,
  });
}

try {
  const tenant = (await registry.listTenants()).find((t) => t.slug === slug);
  if (tenant === undefined) throw new Error(`No tenant "${slug}"`);

  const from = regionOf(tenant);
  if (from === target) {
    console.log(`${slug} is already in ${target}; nothing to do.`);
  } else {
    // The master table stores the password encrypted; the role in the new
    // region gets the same password, so the tenant row needs no credential change.
    const spec = {
      dbName: tenant.dbName,
      user: tenant.user,
      password: await cipher.decrypt(tenant.password),
    };
    const to = REGIONS[target];

    console.log(`1/5 suspending ${slug} (requests now get 403)`);
    await registry.suspendTenant(tenant.id);
    await sleep(SERVER_TTL_GRACE_MS);

    try {
      console.log(`2/5 creating database in ${to.label}`);
      await createTenantDatabase(target, spec);

      console.log("3/5 copying data");
      const source = connect(tenant.host, tenant.port, spec);
      const destination = connect(to.host, to.port, spec);
      try {
        const SourceOrder = OrderModel(source);
        const DestOrder = OrderModel(destination);
        await destination.sync();
        const rows = (await SourceOrder.findAll()).map((row) => row.get({ plain: true }));
        await DestOrder.bulkCreate(rows);
        console.log(`    copied ${rows.length} order(s)`);
      } finally {
        await source.close();
        await destination.close();
      }
    } catch (err) {
      console.error("Move failed; reactivating the tenant in its original region.");
      await registry.updateTenant(tenant.id, { status: "active" });
      await dropTenantDatabase(target, spec);
      throw err;
    }

    console.log(`4/5 pointing ${slug} at ${to.host}:${to.port} and reactivating`);
    await registry.updateTenant(tenant.id, {
      host: to.host,
      port: to.port,
      meta: { ...tenant.meta, region: target },
      status: "active",
    });

    // Give the server time to switch before the old database disappears.
    await sleep(SERVER_TTL_GRACE_MS);
    console.log(`5/5 dropping old database in ${REGIONS[from].label}`);
    await dropTenantDatabase(from, spec);

    console.log(`Done: ${slug} now lives in ${to.label}.`);
  }
} finally {
  await closeRegistry();
  await closeAdminConnections();
}
