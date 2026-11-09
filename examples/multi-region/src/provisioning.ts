import { Sequelize } from "sequelize";
import { REGIONS, type RegionName } from "./config.js";

/**
 * Physical database provisioning on a region's Postgres server.
 *
 * Kosan never creates databases by itself; the registry calls these from the
 * opt-in `onProvision` / `onDelete` hooks (see registry.ts), and the
 * move-tenant script reuses them.
 */

const adminConnections = new Map<RegionName, Sequelize>();

/** A superuser connection to the region's `postgres` maintenance database. */
function admin(region: RegionName): Sequelize {
  const existing = adminConnections.get(region);
  if (existing !== undefined) return existing;

  const r = REGIONS[region];
  const conn = new Sequelize({
    dialect: "postgres",
    host: r.host,
    port: r.port,
    database: "postgres",
    username: r.adminUser,
    password: r.adminPassword,
    logging: false,
  });
  adminConnections.set(region, conn);
  return conn;
}

/** Only simple identifiers: they are interpolated into DDL. */
function ident(name: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Refusing unsafe identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

interface DatabaseSpec {
  dbName: string;
  user: string;
  password: string;
}

/** Creates a login role and a database it owns. Idempotent. */
export async function createTenantDatabase(region: RegionName, spec: DatabaseSpec): Promise<void> {
  const db = admin(region);
  const password = db.escape(spec.password); // quoted SQL literal

  const [roles] = await db.query("SELECT 1 FROM pg_roles WHERE rolname = :user", {
    replacements: { user: spec.user },
  });
  if (roles.length === 0) {
    await db.query(`CREATE ROLE ${ident(spec.user)} LOGIN PASSWORD ${password}`);
  } else {
    await db.query(`ALTER ROLE ${ident(spec.user)} LOGIN PASSWORD ${password}`);
  }

  const [dbs] = await db.query("SELECT 1 FROM pg_database WHERE datname = :name", {
    replacements: { name: spec.dbName },
  });
  if (dbs.length === 0) {
    await db.query(`CREATE DATABASE ${ident(spec.dbName)} OWNER ${ident(spec.user)}`);
  }
}

/** Drops the database (disconnecting any sessions) and its role. */
export async function dropTenantDatabase(
  region: RegionName,
  spec: Pick<DatabaseSpec, "dbName" | "user">,
): Promise<void> {
  const db = admin(region);
  await db.query(`DROP DATABASE IF EXISTS ${ident(spec.dbName)} WITH (FORCE)`);
  await db.query(`DROP ROLE IF EXISTS ${ident(spec.user)}`);
}

export async function closeAdminConnections(): Promise<void> {
  await Promise.all([...adminConnections.values()].map((c) => c.close()));
  adminConnections.clear();
}
