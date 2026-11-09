import type { Options } from "sequelize";

/**
 * One Postgres server per region. Kosan itself has no notion of "region":
 * each tenant row simply stores the host/port of the server that holds its
 * database. The region name is kept in `tenant.meta.region` for display and
 * for picking the admin connection used to provision databases.
 */
export const REGIONS = {
  eu: {
    label: "Europe (Frankfurt)",
    host: process.env.EU_DB_HOST ?? "localhost",
    port: Number(process.env.EU_DB_PORT ?? 5451),
    adminUser: "admin",
    adminPassword: "admin",
  },
  us: {
    label: "United States (Virginia)",
    host: process.env.US_DB_HOST ?? "localhost",
    port: Number(process.env.US_DB_PORT ?? 5452),
    adminUser: "admin",
    adminPassword: "admin",
  },
} as const;

export type RegionName = keyof typeof REGIONS;

export function isRegion(value: unknown): value is RegionName {
  return typeof value === "string" && Object.hasOwn(REGIONS, value);
}

/** The region a tenant lives in, read from `tenant.meta.region`. */
export function regionOf(tenant: { slug: string; meta?: Record<string, unknown> }): RegionName {
  const region = tenant.meta?.region;
  if (!isRegion(region)) {
    throw new Error(`Tenant "${tenant.slug}" has no valid meta.region (got ${String(region)})`);
  }
  return region;
}

export const MASTER_DB: Options = {
  dialect: "postgres",
  host: process.env.MASTER_DB_HOST ?? "localhost",
  port: Number(process.env.MASTER_DB_PORT ?? 5450),
  database: "master",
  username: "admin",
  password: "admin",
  logging: false,
};
