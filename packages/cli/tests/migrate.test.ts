import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TenantConfig } from "@kosan/core";
import { SequelizeMasterStore } from "@kosan/sequelize";
import type { QueryInterface } from "sequelize";
import { Sequelize } from "sequelize";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printResults } from "../src/commands/migrate.js";
import { type Migration, runMigrationsForTenant } from "../src/runner.js";
import type { KosanConfig, TenantMigrationResult } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = path.join(
    tmpdir(),
    `kosan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig(masterPath: string): KosanConfig {
  return {
    master: { dialect: "sqlite", storage: masterPath, logging: false } as never,
    migrationsPath: "./migrations",
  };
}

function makeTenantConfig(dbPath: string, overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    slug: "acme",
    host: "",
    port: 0,
    dbName: dbPath,
    user: "",
    password: "",
    status: "active",
    meta: { dialect: "sqlite" },
    ...overrides,
  };
}

function makeMigration(name: string, sql: string): Migration {
  return {
    name,
    up: async (qi: QueryInterface) => {
      await qi.sequelize.query(sql);
    },
    down: async (qi: QueryInterface) => {
      void qi;
    },
  };
}

function openSqlite(filePath: string): Sequelize {
  return new Sequelize({ dialect: "sqlite", storage: filePath, logging: false });
}

// ---------------------------------------------------------------------------
// runMigrationsForTenant
// ---------------------------------------------------------------------------

describe("runMigrationsForTenant", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns up-to-date when there are no migrations", async () => {
    const dbPath = path.join(tmpDir, "tenant.sqlite");
    const sequelize = openSqlite(dbPath);
    const tenant = makeTenantConfig(dbPath);

    try {
      const result = await runMigrationsForTenant({
        tenant,
        sequelize,
        config: makeConfig(path.join(tmpDir, "master.sqlite")),
        migrations: [],
      });
      expect(result.outcome).toBe("up-to-date");
      expect(result.applied).toHaveLength(0);
    } finally {
      await sequelize.close();
    }
  });

  it("runs pending migrations and returns migrated", async () => {
    const dbPath = path.join(tmpDir, "tenant.sqlite");
    const sequelize = openSqlite(dbPath);
    const tenant = makeTenantConfig(dbPath);
    const migrations = [
      makeMigration(
        "001-create-notes.js",
        "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY)",
      ),
    ];

    try {
      const result = await runMigrationsForTenant({
        tenant,
        sequelize,
        config: makeConfig(path.join(tmpDir, "master.sqlite")),
        migrations,
      });
      expect(result.outcome).toBe("migrated");
      expect(result.applied).toEqual(["001-create-notes.js"]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await sequelize.close();
    }
  });

  it("is idempotent — second run returns up-to-date", async () => {
    const dbPath = path.join(tmpDir, "tenant.sqlite");
    const tenant = makeTenantConfig(dbPath);
    const config = makeConfig(path.join(tmpDir, "master.sqlite"));
    const migrations = [
      makeMigration(
        "001-create-items.js",
        "CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY)",
      ),
    ];

    const seq1 = openSqlite(dbPath);
    await runMigrationsForTenant({ tenant, sequelize: seq1, config, migrations });
    await seq1.close();

    const seq2 = openSqlite(dbPath);
    try {
      const result = await runMigrationsForTenant({ tenant, sequelize: seq2, config, migrations });
      expect(result.outcome).toBe("up-to-date");
    } finally {
      await seq2.close();
    }
  });

  it("actually creates the table in the database", async () => {
    const dbPath = path.join(tmpDir, "tenant.sqlite");
    const tenant = makeTenantConfig(dbPath);
    const config = makeConfig(path.join(tmpDir, "master.sqlite"));
    const migrations = [
      makeMigration(
        "001-create-events.js",
        "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY)",
      ),
    ];

    const seq = openSqlite(dbPath);
    await runMigrationsForTenant({ tenant, sequelize: seq, config, migrations });
    const [rows] = await seq.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events'",
    );
    expect(rows).toHaveLength(1);
    await seq.close();
  });

  it("captures errors without throwing", async () => {
    const dbPath = path.join(tmpDir, "tenant.sqlite");
    const sequelize = openSqlite(dbPath);
    const tenant = makeTenantConfig(dbPath);
    const migrations = [makeMigration("001-bad.js", "THIS IS NOT VALID SQL !!!")];

    try {
      const result = await runMigrationsForTenant({
        tenant,
        sequelize,
        config: makeConfig(path.join(tmpDir, "master.sqlite")),
        migrations,
      });
      expect(result.outcome).toBe("failed");
      expect(result.error).toBeInstanceOf(Error);
    } finally {
      await sequelize.close();
    }
  });

  it("respects the migrationsTableName option", async () => {
    const dbPath = path.join(tmpDir, "tenant.sqlite");
    const sequelize = openSqlite(dbPath);
    const tenant = makeTenantConfig(dbPath);
    const config: KosanConfig = {
      ...makeConfig(path.join(tmpDir, "master.sqlite")),
      migrationsTableName: "custom_migrations",
    };
    const migrations = [
      makeMigration("001-init.js", "CREATE TABLE IF NOT EXISTS widgets (id INTEGER PRIMARY KEY)"),
    ];

    await runMigrationsForTenant({ tenant, sequelize, config, migrations });

    const [rows] = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='custom_migrations'",
    );
    expect(rows).toHaveLength(1);
    await sequelize.close();
  });

  it("runs multiple migrations in order", async () => {
    const dbPath = path.join(tmpDir, "tenant.sqlite");
    const sequelize = openSqlite(dbPath);
    const tenant = makeTenantConfig(dbPath);
    const order: string[] = [];
    const migrations: Migration[] = [
      {
        name: "001-first.js",
        up: async () => {
          order.push("first");
        },
        down: async () => {},
      },
      {
        name: "002-second.js",
        up: async () => {
          order.push("second");
        },
        down: async () => {},
      },
      {
        name: "003-third.js",
        up: async () => {
          order.push("third");
        },
        down: async () => {},
      },
    ];

    await runMigrationsForTenant({
      tenant,
      sequelize,
      config: makeConfig(path.join(tmpDir, "master.sqlite")),
      migrations,
    });
    expect(order).toEqual(["first", "second", "third"]);
    await sequelize.close();
  });
});

// ---------------------------------------------------------------------------
// printResults
// ---------------------------------------------------------------------------

describe("printResults", () => {
  it("renders a table without throwing", () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const results: TenantMigrationResult[] = [
      {
        tenantId: "t1",
        slug: "acme",
        outcome: "migrated",
        applied: ["001.js", "002.js"],
        durationMs: 42,
      },
      { tenantId: "t2", slug: "globex", outcome: "up-to-date", applied: [], durationMs: 5 },
      {
        tenantId: "t3",
        slug: "bad",
        outcome: "failed",
        applied: [],
        error: new Error("db exploded"),
        durationMs: 1,
      },
      { tenantId: "t4", slug: "skip", outcome: "skipped", applied: [], durationMs: 0 },
    ];

    printResults(results, logger);

    expect(logger.info).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/db exploded/));
  });

  it("handles an empty results array", () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(() => printResults([], logger)).not.toThrow();
  });
});
