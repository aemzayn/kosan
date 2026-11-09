/**
 * Integration tests against real Postgres / MySQL servers.
 *
 * Skipped unless a server URL is provided, e.g.:
 *   KOSAN_TEST_POSTGRES_URL=postgres://postgres:kosan@localhost:55432/postgres
 *   KOSAN_TEST_MYSQL_URL=mysql://root:kosan@localhost:53306/mysql
 *
 * Each run creates uniquely named databases and drops them afterwards.
 */
import { randomBytes } from "node:crypto";
import {
  type Cipher,
  type LifecycleHooks,
  TenantNotActiveError,
  TenantRegistry,
} from "@kosan/core";
import { DataTypes, type Dialect, Sequelize } from "sequelize";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SequelizeAdapter } from "../../src/SequelizeAdapter.js";
import { SequelizeMasterStore } from "../../src/SequelizeMasterStore.js";

interface Server {
  dialect: Extract<Dialect, "postgres" | "mysql">;
  url: string | undefined;
}

const servers: Server[] = [
  { dialect: "postgres", url: process.env.KOSAN_TEST_POSTGRES_URL || undefined },
  { dialect: "mysql", url: process.env.KOSAN_TEST_MYSQL_URL || undefined },
];

/** Reversible "encryption" — enough to prove the stored value is not what connects. */
const cipher: Cipher = {
  encrypt: async (plain) => `enc:${Buffer.from(plain).toString("base64")}`,
  decrypt: async (stored) => Buffer.from(stored.replace(/^enc:/, ""), "base64").toString(),
};

for (const server of servers) {
  describe.skipIf(server.url === undefined)(`Sequelize adapter on real ${server.dialect}`, () => {
    const url = new URL(server.url ?? "postgres://unused");
    const conn = {
      host: url.hostname,
      port: Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
    const suffix = randomBytes(4).toString("hex");
    const dbName = (name: string) => `kosan_it_${suffix}_${name}`;
    const created: string[] = [];

    let admin: Sequelize;
    let masterSeq: Sequelize;
    let store: SequelizeMasterStore;
    const registries: TenantRegistry<Sequelize>[] = [];

    const quote = (name: string) => admin.getQueryInterface().quoteIdentifier(name);

    async function createDatabase(name: string): Promise<void> {
      await admin.query(`CREATE DATABASE ${quote(name)}`);
      created.push(name);
    }

    async function makeRegistry(hooks: LifecycleHooks<Sequelize>, adapter = newAdapter()) {
      const registry = await TenantRegistry.create({ master: store, adapter, cipher, hooks });
      registry.registerModels([
        (sequelize: Sequelize) => sequelize.define("Order", { label: DataTypes.STRING }),
      ]);
      registries.push(registry);
      return registry;
    }

    function newAdapter() {
      return new SequelizeAdapter({ defaultDialect: server.dialect, pool: { max: 2 } });
    }

    const provisionDatabase = async (tenant: { dbName: string }) => createDatabase(tenant.dbName);
    const provisioning: LifecycleHooks<Sequelize> = {
      onProvision: provisionDatabase,
      onCreate: async (_tenant, sequelize) => {
        await sequelize.sync();
      },
    };

    function tenantInput(slug: string) {
      return {
        slug,
        host: conn.host,
        port: conn.port,
        dbName: dbName(slug),
        user: conn.user,
        password: conn.password,
      };
    }

    beforeAll(async () => {
      admin = new Sequelize(server.url ?? "", { logging: false });
      await createDatabase(dbName("master"));
      masterSeq = new Sequelize({
        dialect: server.dialect,
        host: conn.host,
        port: conn.port,
        username: conn.user,
        password: conn.password,
        database: dbName("master"),
        logging: false,
      });
      store = await SequelizeMasterStore.create(masterSeq);
    }, 60_000);

    afterAll(async () => {
      await Promise.all(registries.map((r) => r.shutdown()));
      await masterSeq?.close();
      const force = server.dialect === "postgres" ? " WITH (FORCE)" : "";
      for (const name of created) {
        await admin.query(`DROP DATABASE IF EXISTS ${quote(name)}${force}`);
      }
      await admin?.close();
    }, 60_000);

    it("provisions tenant databases and keeps each tenant's data isolated", async () => {
      const registry = await makeRegistry(provisioning);
      await registry.createTenant(tenantInput("acme"));
      await registry.createTenant(tenantInput("globex"));

      for (const slug of ["acme", "globex"]) {
        const { connection } = await registry.resolveBySlug(slug);
        await connection.model("Order").create({ label: `${slug}-order` });
      }

      const acme = await registry.resolveBySlug("acme");
      const rows = await acme.connection.model("Order").findAll();
      expect(rows.map((r) => r.get("label"))).toEqual(["acme-order"]);
    }, 60_000);

    it("stores the password encrypted and connects with the decrypted one", async () => {
      const row = await store.findBySlug("acme");
      expect(row?.password).toMatch(/^enc:/);
      expect(row?.password).not.toContain(conn.password);
      // Resolving opens a real authenticated connection with the decrypted password.
      const registry = await makeRegistry({});
      const { connection } = await registry.resolveBySlug("acme");
      await expect(connection.authenticate()).resolves.toBeUndefined();
    }, 60_000);

    it("shares one connection pool between concurrent first requests", async () => {
      const adapter = newAdapter();
      const connect = vi.spyOn(adapter, "connect");
      const registry = await makeRegistry({}, adapter);

      const contexts = await Promise.all(
        Array.from({ length: 5 }, () => registry.resolveBySlug("globex")),
      );
      expect(connect).toHaveBeenCalledTimes(1);
      expect(new Set(contexts.map((c) => c.connection)).size).toBe(1);
    }, 60_000);

    it("rolls back the master row when onCreate fails", async () => {
      const registry = await makeRegistry({
        onProvision: provisionDatabase,
        onCreate: async () => {
          throw new Error("initial migration failed");
        },
      });
      await expect(registry.createTenant(tenantInput("broken"))).rejects.toThrow(
        "initial migration failed",
      );
      expect(await store.findBySlug("broken")).toBeNull();
    }, 60_000);

    it("rejects requests for a suspended tenant", async () => {
      const registry = await makeRegistry(provisioning);
      const tenant = await registry.createTenant(tenantInput("initech"));
      await registry.resolveBySlug("initech");

      await registry.suspendTenant(tenant.id);
      await expect(registry.resolveBySlug("initech")).rejects.toThrow(TenantNotActiveError);
    }, 60_000);
  });
}
