import { TenantRegistry, runWithTenant } from "@kosan/core";
import type { TenantConfig } from "@kosan/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaAdapter } from "../src/PrismaAdapter.js";
import { usePrisma } from "../src/context.js";
import type { PrismaClientLike } from "../src/types.js";

// ---------------------------------------------------------------------------
// Minimal fake PrismaClient
// ---------------------------------------------------------------------------

interface FakeClient extends PrismaClientLike {
  _url: string;
  connected: boolean;
  disconnected: boolean;
}

function makeFakeClientClass() {
  return class MockPrismaClient implements FakeClient {
    _url: string;
    connected = false;
    disconnected = false;

    constructor(options: { datasources: { [k: string]: { url: string } } }) {
      this._url = Object.values(options.datasources)[0]?.url ?? "";
    }

    async $connect(): Promise<void> {
      this.connected = true;
    }
    async $disconnect(): Promise<void> {
      this.disconnected = true;
    }
  };
}

function makeTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    id: "tenant-1",
    slug: "acme",
    host: "db.example.com",
    port: 5432,
    dbName: "acme_db",
    user: "acme",
    password: "secret",
    status: "active",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PrismaAdapter tests
// ---------------------------------------------------------------------------

describe("PrismaAdapter", () => {
  let FakePrismaClient: ReturnType<typeof makeFakeClientClass>;
  let adapter: PrismaAdapter<FakeClient>;

  beforeEach(() => {
    FakePrismaClient = makeFakeClientClass();
    adapter = new PrismaAdapter({
      PrismaClient: FakePrismaClient,
      buildUrl: (t) => `postgresql://${t.user}:${t.password}@${t.host}:${t.port}/${t.dbName}`,
    });
  });

  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------

  describe("connect", () => {
    it("creates a client with the URL built from tenant config", async () => {
      const tenant = makeTenant();
      const client = await adapter.connect(tenant);
      expect(client._url).toBe("postgresql://acme:secret@db.example.com:5432/acme_db");
    });

    it("calls $connect on the new client", async () => {
      const tenant = makeTenant();
      const client = await adapter.connect(tenant);
      expect(client.connected).toBe(true);
    });

    it("creates separate instances per tenant", async () => {
      const t1 = makeTenant({ id: "t1", slug: "a" });
      const t2 = makeTenant({ id: "t2", slug: "b", user: "other" });
      const c1 = await adapter.connect(t1);
      const c2 = await adapter.connect(t2);
      expect(c1).not.toBe(c2);
    });

    it("respects a custom datasourceName", async () => {
      const custom = new PrismaAdapter({
        PrismaClient: FakePrismaClient,
        buildUrl: () => "postgresql://x",
        datasourceName: "postgres",
      });
      const client = (await custom.connect(makeTenant())) as FakeClient & { _url: string };
      expect(client._url).toBe("postgresql://x");
    });
  });

  // -------------------------------------------------------------------------
  // disconnect
  // -------------------------------------------------------------------------

  describe("disconnect", () => {
    it("calls $disconnect on the client", async () => {
      const client = await adapter.connect(makeTenant());
      await adapter.disconnect(client);
      expect(client.disconnected).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getModels
  // -------------------------------------------------------------------------

  describe("getModels", () => {
    it("returns { prisma: client }", async () => {
      const client = await adapter.connect(makeTenant());
      const models = adapter.getModels(client);
      expect(models.prisma).toBe(client);
    });
  });

  // -------------------------------------------------------------------------
  // registerModelFactories
  // -------------------------------------------------------------------------

  describe("registerModelFactories", () => {
    it("throws because Prisma does not use model factories", () => {
      expect(() => adapter.registerModelFactories([])).toThrow(
        /does not support registerModelFactories/,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// usePrisma
// ---------------------------------------------------------------------------

describe("usePrisma", () => {
  it("returns the client when called inside a tenant context", async () => {
    const FakeClient = makeFakeClientClass();
    const adapter = new PrismaAdapter({
      PrismaClient: FakeClient,
      buildUrl: () => "postgresql://x",
    });
    const tenant = makeTenant();
    const connection = await adapter.connect(tenant);
    const models = adapter.getModels(connection);

    await runWithTenant({ tenant, connection, models }, async () => {
      const prisma = usePrisma<FakeClient>();
      expect(prisma).toBe(connection);
    });
  });

  it("throws outside of a tenant context", () => {
    expect(() => usePrisma()).toThrow(/called outside/);
  });

  it("throws when the context was set up without a PrismaAdapter", async () => {
    const tenant = makeTenant();
    await runWithTenant({ tenant, connection: {}, models: {} }, async () => {
      expect(() => usePrisma()).toThrow(/PrismaAdapter/);
    });
  });

  it("integrates with TenantRegistry end-to-end", async () => {
    const { InMemoryMasterStore } = await import("../../core/tests/helpers/InMemoryMasterStore.js");

    const FakeClient = makeFakeClientClass();
    const adapter = new PrismaAdapter({
      PrismaClient: FakeClient,
      buildUrl: (t) => `postgresql://${t.user}:${t.password}@${t.host}:${t.port}/${t.dbName}`,
    });

    const master = new InMemoryMasterStore();
    const registry = await TenantRegistry.create({ master, adapter });

    await registry.createTenant({
      slug: "acme",
      host: "localhost",
      port: 5432,
      dbName: "acme_db",
      user: "u",
      password: "p",
    });

    const ctx = await registry.resolveBySlug("acme");
    await runWithTenant(ctx, async () => {
      const prisma = usePrisma<FakeClient>();
      expect(prisma._url).toBe("postgresql://u:p@localhost:5432/acme_db");
      expect(prisma.connected).toBe(true);
    });

    await registry.shutdown();
  });
});
