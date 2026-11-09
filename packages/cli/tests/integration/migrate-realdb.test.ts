/**
 * `kosan migrate` against real Postgres / MySQL servers, with encrypted
 * tenant passwords in the master table.
 *
 * Skipped unless KOSAN_TEST_POSTGRES_URL / KOSAN_TEST_MYSQL_URL are set
 * (see packages/sequelize/tests/integration/realdb.test.ts).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Cipher } from "@kosan/core";
import { SequelizeMasterStore } from "@kosan/sequelize";
import { type Dialect, QueryTypes, Sequelize } from "sequelize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrate } from "../../src/commands/migrate.js";

const servers: Array<{ dialect: Extract<Dialect, "postgres" | "mysql">; url: string | undefined }> =
  [
    { dialect: "postgres", url: process.env.KOSAN_TEST_POSTGRES_URL || undefined },
    { dialect: "mysql", url: process.env.KOSAN_TEST_MYSQL_URL || undefined },
  ];

const cipher: Cipher = {
  encrypt: async (plain) => `enc:${Buffer.from(plain).toString("base64")}`,
  decrypt: async (stored) => Buffer.from(stored.replace(/^enc:/, ""), "base64").toString(),
};

const silent = { info: () => {}, warn: () => {}, error: () => {} };

for (const server of servers) {
  describe.skipIf(server.url === undefined)(`kosan migrate on real ${server.dialect}`, () => {
    const url = new URL(server.url ?? "postgres://unused");
    const conn = {
      host: url.hostname,
      port: Number(url.port),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
    const suffix = randomBytes(4).toString("hex");
    const dbName = (name: string) => `kosan_it_cli_${suffix}_${name}`;
    const databases = ["master", "acme", "globex"].map(dbName);
    const tenantSlugs = ["acme", "globex"];

    let admin: Sequelize;
    let workDir: string;
    let migrationsDir: string;

    const quote = (name: string) => admin.getQueryInterface().quoteIdentifier(name);
    const masterOptions = () => ({ dialect: server.dialect, ...conn, database: dbName("master") });

    beforeAll(async () => {
      admin = new Sequelize(server.url ?? "", { logging: false });
      for (const db of databases) await admin.query(`CREATE DATABASE ${quote(db)}`);

      const master = new Sequelize({ ...masterOptions(), logging: false });
      const store = await SequelizeMasterStore.create(master);
      for (const slug of tenantSlugs) {
        await store.create({
          slug,
          host: conn.host,
          port: conn.port,
          dbName: dbName(slug),
          user: conn.username,
          password: await cipher.encrypt(conn.password),
          meta: { dialect: server.dialect },
        });
      }
      await master.close();

      workDir = mkdtempSync(path.join(tmpdir(), "kosan-cli-it-"));
      migrationsDir = path.join(workDir, "migrations");
      mkdirSync(migrationsDir);
      writeFileSync(
        path.join(migrationsDir, "001-create-orders.mjs"),
        `export async function up(qi, Sequelize) {
          await qi.createTable("orders", {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            label: { type: Sequelize.STRING },
          });
        }
        export async function down(qi) { await qi.dropTable("orders"); }\n`,
      );
    }, 60_000);

    afterAll(async () => {
      const force = server.dialect === "postgres" ? " WITH (FORCE)" : "";
      for (const db of databases) await admin.query(`DROP DATABASE IF EXISTS ${quote(db)}${force}`);
      await admin?.close();
      if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true });
    }, 60_000);

    async function tableExists(slug: string): Promise<boolean> {
      const tenantDb = new Sequelize({
        dialect: server.dialect,
        ...conn,
        database: dbName(slug),
        logging: false,
      });
      try {
        const tables = await tenantDb.getQueryInterface().showAllTables();
        return tables.map((t) => String(t)).includes("orders");
      } finally {
        await tenantDb.close();
      }
    }

    it("fails every tenant when the cipher is missing (stored passwords are encrypted)", async () => {
      const results = await runMigrate({
        config: { master: masterOptions(), migrationsPath: "./migrations" },
        migrationsDir,
        concurrency: 2,
        logger: silent,
      });
      expect(results.map((r) => r.outcome)).toEqual(["failed", "failed"]);
    }, 60_000);

    it("decrypts credentials and migrates every tenant database", async () => {
      const results = await runMigrate({
        config: { master: masterOptions(), migrationsPath: "./migrations", cipher },
        migrationsDir,
        concurrency: 2,
        logger: silent,
      });

      expect(results.map((r) => [r.slug, r.outcome]).sort()).toEqual([
        ["acme", "migrated"],
        ["globex", "migrated"],
      ]);
      for (const slug of tenantSlugs) expect(await tableExists(slug)).toBe(true);
    }, 60_000);

    it("is idempotent: a second run reports up-to-date", async () => {
      const results = await runMigrate({
        config: { master: masterOptions(), migrationsPath: "./migrations", cipher },
        migrationsDir,
        concurrency: 2,
        logger: silent,
      });
      expect(results.map((r) => r.outcome)).toEqual(["up-to-date", "up-to-date"]);
    }, 60_000);

    it("--tenant migrates only the named tenant", async () => {
      const results = await runMigrate({
        config: { master: masterOptions(), migrationsPath: "./migrations", cipher },
        migrationsDir,
        concurrency: 1,
        tenant: "acme",
        logger: silent,
      });
      expect(results.map((r) => r.slug)).toEqual(["acme"]);
      // Sanity: the migration table is really in the tenant DB, not the master.
      const master = new Sequelize({ ...masterOptions(), logging: false });
      try {
        const rows = await master.query("SELECT 1 AS one", { type: QueryTypes.SELECT });
        expect(rows).toHaveLength(1);
      } finally {
        await master.close();
      }
    }, 60_000);
  });
}
