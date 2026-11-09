import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Cipher, TenantConfig } from "@kosan/core";
import { SequelizeMasterStore } from "@kosan/sequelize";
import { Sequelize } from "sequelize";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveConcurrency,
  runMigrate,
  tenantConnectionOptions,
} from "../src/commands/migrate.js";

const cipher: Cipher = {
  encrypt: async (plain) => `enc:${plain}`,
  decrypt: async (stored) => stored.replace(/^enc:/, ""),
};

function tenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    id: "t1",
    slug: "acme",
    host: "db.internal",
    port: 5432,
    dbName: "acme_db",
    user: "acme",
    password: "enc:s3cret",
    status: "active",
    ...overrides,
  };
}

describe("tenantConnectionOptions", () => {
  it("decrypts the stored password when a cipher is configured", async () => {
    const opts = await tenantConnectionOptions(tenant(), cipher);
    expect(opts).toMatchObject({
      dialect: "postgres",
      host: "db.internal",
      database: "acme_db",
      username: "acme",
      password: "s3cret",
    });
  });

  it("uses the stored password as-is without a cipher", async () => {
    const opts = await tenantConnectionOptions(tenant({ password: "plain" }), undefined);
    expect(opts.password).toBe("plain");
  });

  it("maps sqlite tenants to a storage file", async () => {
    const opts = await tenantConnectionOptions(
      tenant({ dbName: "/tmp/acme.sqlite", meta: { dialect: "sqlite" } }),
      cipher,
    );
    expect(opts).toMatchObject({ dialect: "sqlite", storage: "/tmp/acme.sqlite" });
    expect(opts).not.toHaveProperty("password");
  });
});

describe("resolveConcurrency", () => {
  it("prefers the --concurrency flag", () => {
    expect(resolveConcurrency("8", 2)).toBe(8);
  });

  it("falls back to config.concurrency when no flag is given", () => {
    expect(resolveConcurrency(undefined, 2)).toBe(2);
  });

  it("defaults to 4", () => {
    expect(resolveConcurrency(undefined, undefined)).toBe(4);
  });

  it("ignores a non-numeric or non-finite config value", () => {
    expect(resolveConcurrency(undefined, Number.NaN)).toBe(4);
    expect(resolveConcurrency(undefined, Number.POSITIVE_INFINITY)).toBe(4);
    expect(resolveConcurrency(undefined, 2.7)).toBe(2);
  });

  it("ignores invalid values and never goes below 1", () => {
    expect(resolveConcurrency("abc", 3)).toBe(3);
    expect(resolveConcurrency("0", undefined)).toBe(1);
    expect(resolveConcurrency(undefined, -5)).toBe(1);
  });
});

describe("runMigrate (end to end, SQLite)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kosan-run-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedMaster(
    masterPath: string,
    slugs: string[],
    dbPath: (slug: string) => string = (slug) => path.join(dir, `${slug}.sqlite`),
  ): Promise<void> {
    const master = new Sequelize({ dialect: "sqlite", storage: masterPath, logging: false });
    const store = await SequelizeMasterStore.create(master);
    for (const slug of slugs) {
      await store.create({
        slug,
        host: "",
        port: 0,
        dbName: dbPath(slug),
        user: "",
        password: await cipher.encrypt("pw"),
        meta: { dialect: "sqlite" },
      });
    }
    await master.close();
  }

  it("migrates every active tenant from the master DB", async () => {
    const masterPath = path.join(dir, "master.sqlite");
    await seedMaster(masterPath, ["acme", "globex"]);

    const migrationsDir = path.join(dir, "migrations");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(migrationsDir);
    writeFileSync(
      path.join(migrationsDir, "001-orders.mjs"),
      "export async function up(qi) { await qi.sequelize.query('CREATE TABLE orders (id INTEGER)'); }\n" +
        "export async function down() {}\n",
    );

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const results = await runMigrate({
      config: {
        master: { dialect: "sqlite", storage: masterPath },
        migrationsPath: "./migrations",
        cipher,
      },
      migrationsDir,
      concurrency: 2,
      logger,
    });

    expect(results.map((r) => [r.slug, r.outcome]).sort()).toEqual([
      ["acme", "migrated"],
      ["globex", "migrated"],
    ]);
  });

  it("isolates a tenant whose database cannot be opened instead of aborting the run", async () => {
    const masterPath = path.join(dir, "master.sqlite");
    // A regular file where a directory should be: the DB can never be opened.
    const blocker = path.join(dir, "not-a-directory");
    writeFileSync(blocker, "");
    await seedMaster(masterPath, ["acme", "broken"], (slug) =>
      slug === "broken" ? path.join(blocker, "broken.sqlite") : path.join(dir, `${slug}.sqlite`),
    );
    const migrationsDir = path.join(dir, "migrations");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(migrationsDir);
    writeFileSync(
      path.join(migrationsDir, "001-orders.mjs"),
      "export async function up(qi) { await qi.sequelize.query('CREATE TABLE orders (id INTEGER)'); }\n" +
        "export async function down() {}\n",
    );

    const results = await runMigrate({
      config: { master: { dialect: "sqlite", storage: masterPath }, migrationsPath: "m", cipher },
      migrationsDir,
      concurrency: 2,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const bySlug = Object.fromEntries(results.map((r) => [r.slug, r]));
    expect(bySlug.acme?.outcome).toBe("migrated");
    expect(bySlug.broken?.outcome).toBe("failed");
    expect(bySlug.broken?.error).toBeInstanceOf(Error);
  });
});
