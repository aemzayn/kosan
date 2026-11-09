import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TenantNotActiveError,
  TenantNotFoundError,
  TenantRegistry,
} from "../src/TenantRegistry.js";
import type { CreateTenantInput, TenantConfig } from "../src/types.js";
import { FakeAdapter } from "./helpers/FakeAdapter.js";
import { InMemoryMasterStore } from "./helpers/InMemoryMasterStore.js";

const BASE_INPUT: CreateTenantInput = {
  slug: "acme",
  host: "localhost",
  port: 5432,
  dbName: "acme_db",
  user: "acme_user",
  password: "secret",
};

describe("TenantRegistry", () => {
  let master: InMemoryMasterStore;
  let adapter: FakeAdapter;
  let registry: TenantRegistry;

  beforeEach(async () => {
    master = new InMemoryMasterStore();
    adapter = new FakeAdapter();
    registry = await TenantRegistry.create({ master, adapter });
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  // -------------------------------------------------------------------------
  // createTenant
  // -------------------------------------------------------------------------

  describe("createTenant", () => {
    it("persists the tenant and returns it", async () => {
      const tenant = await registry.createTenant(BASE_INPUT);
      expect(tenant.slug).toBe("acme");
      expect(tenant.status).toBe("active");
      expect(tenant.id).toBeTruthy();
    });

    it("calls onCreate hook with a throw-away connection", async () => {
      const onCreateMock = vi.fn<
        Parameters<NonNullable<(typeof registry)["hooks"]>["onCreate"] & {}>,
        Promise<void>
      >();
      const r = await TenantRegistry.create({
        master,
        adapter,
        hooks: { onCreate: onCreateMock },
      });

      await r.createTenant(BASE_INPUT);

      expect(onCreateMock).toHaveBeenCalledOnce();
      // Throw-away conn should be disconnected, not in registry cache.
      expect(r.cache.size).toBe(0);
      expect(adapter.disconnectCallCount).toBe(1);
      await r.shutdown();
    });

    it("encrypts the password when a cipher is provided", async () => {
      const cipher = {
        encrypt: vi.fn(async (p: string) => `enc:${p}`),
        decrypt: vi.fn(async (p: string) => p.slice(4)),
      };
      const r = await TenantRegistry.create({ master, adapter, cipher });
      await r.createTenant(BASE_INPUT);

      const stored = await master.findBySlug("acme");
      expect(stored?.password).toBe("enc:secret");
      await r.shutdown();
    });

    it("does not call onCreate when no hook is registered", async () => {
      await registry.createTenant(BASE_INPUT);
      // No throw-away connection was created.
      expect(adapter.connectCallCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // resolveBySlug / resolveById
  // -------------------------------------------------------------------------

  describe("resolveBySlug", () => {
    it("returns context value for an active tenant", async () => {
      const created = await registry.createTenant(BASE_INPUT);
      const ctx = await registry.resolveBySlug("acme");

      expect(ctx.tenant.id).toBe(created.id);
      expect(ctx.connection).toBeDefined();
      expect(ctx.models).toBeDefined();
    });

    it("does not expose the database password in the request context", async () => {
      await registry.createTenant(BASE_INPUT);
      const ctx = await registry.resolveBySlug("acme");
      expect(ctx.tenant).not.toHaveProperty("password");
      expect(ctx.tenant.slug).toBe("acme");
    });

    it("caches the connection across calls", async () => {
      await registry.createTenant(BASE_INPUT);
      const first = await registry.resolveBySlug("acme");
      const second = await registry.resolveBySlug("acme");
      expect(first.connection).toBe(second.connection);
      expect(adapter.connectCallCount).toBe(1);
    });

    it("throws TenantNotFoundError for unknown slug", async () => {
      await expect(registry.resolveBySlug("unknown")).rejects.toThrow(TenantNotFoundError);
    });

    it("throws TenantNotActiveError for suspended tenant", async () => {
      const { id } = await registry.createTenant(BASE_INPUT);
      await master.update(id, { status: "suspended" });
      await expect(registry.resolveBySlug("acme")).rejects.toThrow(TenantNotActiveError);
    });

    it("decrypts credentials before connecting", async () => {
      const cipher = {
        encrypt: async (p: string) => `enc:${p}`,
        decrypt: vi.fn(async (p: string) => p.slice(4)),
      };
      const r = await TenantRegistry.create({ master, adapter, cipher });
      await r.createTenant(BASE_INPUT);
      await r.resolveBySlug("acme");
      expect(adapter.connectedWith.at(-1)?.password).toBe("secret");
      expect(cipher.decrypt).toHaveBeenCalledOnce();
      await r.shutdown();
    });
  });

  describe("resolveById", () => {
    it("resolves by id", async () => {
      const created = await registry.createTenant(BASE_INPUT);
      const ctx = await registry.resolveById(created.id);
      expect(ctx.tenant.slug).toBe("acme");
    });

    it("throws TenantNotFoundError for unknown id", async () => {
      await expect(registry.resolveById("no-such-id")).rejects.toThrow(TenantNotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // suspendTenant
  // -------------------------------------------------------------------------

  describe("suspendTenant", () => {
    it("sets status to suspended and evicts the cache", async () => {
      const { id } = await registry.createTenant(BASE_INPUT);
      await registry.resolveBySlug("acme"); // warm the cache
      expect(registry.cache.size).toBe(1);

      await registry.suspendTenant(id);

      expect(registry.cache.size).toBe(0);
      const stored = await master.findById(id);
      expect(stored?.status).toBe("suspended");
    });

    it("calls onSuspend hook", async () => {
      const onSuspend = vi.fn<
        [Parameters<NonNullable<LifecycleHooks["onSuspend"]>>[0]],
        Promise<void>
      >();
      const r = await TenantRegistry.create({
        master,
        adapter,
        hooks: { onSuspend },
      });
      const { id } = await r.createTenant(BASE_INPUT);
      await r.suspendTenant(id);
      expect(onSuspend).toHaveBeenCalledOnce();
      await r.shutdown();
    });
  });

  // -------------------------------------------------------------------------
  // deleteTenant
  // -------------------------------------------------------------------------

  describe("deleteTenant", () => {
    it("removes tenant from master and evicts cache", async () => {
      const { id } = await registry.createTenant(BASE_INPUT);
      await registry.resolveBySlug("acme");
      await registry.deleteTenant(id);

      expect(await master.findById(id)).toBeNull();
      expect(registry.cache.size).toBe(0);
    });

    it("calls onDelete hook", async () => {
      const onDelete = vi.fn();
      const r = await TenantRegistry.create({ master, adapter, hooks: { onDelete } });
      const { id } = await r.createTenant(BASE_INPUT);
      await r.deleteTenant(id);
      expect(onDelete).toHaveBeenCalledOnce();
      await r.shutdown();
    });
  });

  // -------------------------------------------------------------------------
  // updateTenant
  // -------------------------------------------------------------------------

  describe("updateTenant", () => {
    it("updates the record and evicts cache so next resolve uses new config", async () => {
      const { id } = await registry.createTenant(BASE_INPUT);
      await registry.resolveBySlug("acme");
      expect(registry.cache.size).toBe(1);

      await registry.updateTenant(id, { host: "db2.example.com" });
      expect(registry.cache.size).toBe(0);

      const stored = await master.findById(id);
      expect(stored?.host).toBe("db2.example.com");
    });

    it("re-encrypts password on update when cipher is present", async () => {
      const cipher = {
        encrypt: vi.fn(async (p: string) => `enc:${p}`),
        decrypt: async (p: string) => p.slice(4),
      };
      const r = await TenantRegistry.create({ master, adapter, cipher });
      const { id } = await r.createTenant(BASE_INPUT);
      await r.updateTenant(id, { password: "newpass" });

      const stored = await master.findById(id);
      expect(stored?.password).toBe("enc:newpass");
      await r.shutdown();
    });
  });

  // -------------------------------------------------------------------------
  // listTenants / getTenant
  // -------------------------------------------------------------------------

  describe("listTenants", () => {
    it("returns all tenants without a filter", async () => {
      await registry.createTenant(BASE_INPUT);
      await registry.createTenant({ ...BASE_INPUT, slug: "globex" });
      const all = await registry.listTenants();
      expect(all).toHaveLength(2);
    });

    it("filters by status", async () => {
      const { id } = await registry.createTenant(BASE_INPUT);
      await registry.createTenant({ ...BASE_INPUT, slug: "globex" });
      await registry.suspendTenant(id);

      const active = await registry.listTenants({ status: "active" });
      expect(active).toHaveLength(1);
      expect(active[0]?.slug).toBe("globex");
    });
  });

  describe("getTenant", () => {
    it("returns null for missing id", async () => {
      expect(await registry.getTenant("nope")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // registerModels
  // -------------------------------------------------------------------------

  describe("registerModels", () => {
    it("registers model factories on the adapter", () => {
      const factory = () => ({ name: "Order" });
      expect(() => registry.registerModels([factory])).not.toThrow();
    });

    it("throws when adapter does not support model factories", async () => {
      const minimalAdapter = {
        connect: adapter.connect.bind(adapter),
        disconnect: adapter.disconnect.bind(adapter),
        getModels: adapter.getModels.bind(adapter),
        // no registerModelFactories
      };
      const r = await TenantRegistry.create({ master, adapter: minimalAdapter });
      expect(() => r.registerModels([() => ({})])).toThrow();
      await r.shutdown();
    });
  });
});

// ---------------------------------------------------------------------------
// Bring in LifecycleHooks for the hook tests (used in type position above).
// ---------------------------------------------------------------------------
import type { LifecycleHooks } from "../src/types.js";

// ---------------------------------------------------------------------------
// Tenant lookup cache (avoids a master-DB query on every request)
// ---------------------------------------------------------------------------

describe("TenantRegistry tenant lookup cache", () => {
  let master: InMemoryMasterStore;
  let adapter: FakeAdapter;

  beforeEach(() => {
    master = new InMemoryMasterStore();
    adapter = new FakeAdapter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function makeRegistry(tenantTtlMs?: number) {
    const cache = tenantTtlMs === undefined ? {} : { tenantTtlMs };
    return TenantRegistry.create({ master, adapter, cache });
  }

  it("serves repeat lookups from cache within the TTL", async () => {
    const r = await makeRegistry();
    await r.createTenant(BASE_INPUT);
    const findBySlug = vi.spyOn(master, "findBySlug");

    await r.resolveBySlug("acme");
    await r.resolveBySlug("acme");
    expect(findBySlug).toHaveBeenCalledTimes(1);
    await r.shutdown();
  });

  it("shares cached rows between slug and id lookups", async () => {
    const r = await makeRegistry();
    const { id } = await r.createTenant(BASE_INPUT);
    const findById = vi.spyOn(master, "findById");

    await r.resolveBySlug("acme");
    await r.resolveById(id);
    expect(findById).not.toHaveBeenCalled();
    await r.shutdown();
  });

  it("re-reads the master DB once the TTL expires", async () => {
    vi.useFakeTimers();
    const r = await makeRegistry(1_000);
    await r.createTenant(BASE_INPUT);
    const findBySlug = vi.spyOn(master, "findBySlug");

    await r.resolveBySlug("acme");
    vi.advanceTimersByTime(1_001);
    await r.resolveBySlug("acme");
    expect(findBySlug).toHaveBeenCalledTimes(2);
    await r.shutdown();
  });

  it("is disabled with tenantTtlMs: 0", async () => {
    const r = await makeRegistry(0);
    await r.createTenant(BASE_INPUT);
    const findBySlug = vi.spyOn(master, "findBySlug");

    await r.resolveBySlug("acme");
    await r.resolveBySlug("acme");
    expect(findBySlug).toHaveBeenCalledTimes(2);
    await r.shutdown();
  });

  it("does not cache unknown slugs, so a newly created tenant resolves immediately", async () => {
    const r = await makeRegistry();
    await expect(r.resolveBySlug("acme")).rejects.toThrow(TenantNotFoundError);
    await r.createTenant(BASE_INPUT);
    await expect(r.resolveBySlug("acme")).resolves.toMatchObject({ tenant: { slug: "acme" } });
    await r.shutdown();
  });

  it("suspendTenant takes effect immediately on this instance", async () => {
    const r = await makeRegistry();
    const { id } = await r.createTenant(BASE_INPUT);
    await r.resolveBySlug("acme");

    await r.suspendTenant(id);
    await expect(r.resolveBySlug("acme")).rejects.toThrow(TenantNotActiveError);
    await r.shutdown();
  });

  it("deleteTenant takes effect immediately on this instance", async () => {
    const r = await makeRegistry();
    const { id } = await r.createTenant(BASE_INPUT);
    await r.resolveBySlug("acme");

    await r.deleteTenant(id);
    await expect(r.resolveBySlug("acme")).rejects.toThrow(TenantNotFoundError);
    await r.shutdown();
  });

  it("updateTenant drops the old slug when a tenant is renamed", async () => {
    const r = await makeRegistry();
    const { id } = await r.createTenant(BASE_INPUT);
    await r.resolveBySlug("acme");

    await r.updateTenant(id, { slug: "acme-corp" });
    await expect(r.resolveBySlug("acme")).rejects.toThrow(TenantNotFoundError);
    await expect(r.resolveBySlug("acme-corp")).resolves.toMatchObject({
      tenant: { slug: "acme-corp" },
    });
    await r.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Provisioning lifecycle: onProvision → connect → onCreate, with rollback
// ---------------------------------------------------------------------------

describe("TenantRegistry provisioning", () => {
  let master: InMemoryMasterStore;
  let adapter: FakeAdapter;

  beforeEach(() => {
    master = new InMemoryMasterStore();
    adapter = new FakeAdapter();
  });

  it("runs onProvision before any connection, then onCreate with one", async () => {
    const order: string[] = [];
    const realConnect = adapter.connect.bind(adapter);
    adapter.connect = async (t) => {
      order.push("connect");
      return realConnect(t);
    };
    const r = await TenantRegistry.create({
      master,
      adapter,
      hooks: {
        onProvision: async () => {
          order.push("provision");
        },
        onCreate: async () => {
          order.push("create");
        },
      },
    });

    const tenant = await r.createTenant(BASE_INPUT);
    expect(order).toEqual(["provision", "connect", "create"]);
    expect(tenant.status).toBe("active");
    await r.shutdown();
  });

  it("gives onProvision decrypted credentials", async () => {
    const onProvision = vi.fn(async (_t: TenantConfig) => {});
    const r = await TenantRegistry.create({
      master,
      adapter,
      cipher: { encrypt: async (p) => `enc:${p}`, decrypt: async (p) => p.slice(4) },
      hooks: { onProvision },
    });
    await r.createTenant(BASE_INPUT);
    expect(onProvision.mock.calls[0]?.[0].password).toBe("secret");
    await r.shutdown();
  });

  it("does not open a connection when only onProvision is set", async () => {
    const r = await TenantRegistry.create({
      master,
      adapter,
      hooks: { onProvision: async () => {} },
    });
    await r.createTenant(BASE_INPUT);
    expect(adapter.connectCallCount).toBe(0);
    await r.shutdown();
  });

  it("keeps the tenant unresolvable until provisioning finishes", async () => {
    let duringProvision: unknown;
    const r: TenantRegistry = await TenantRegistry.create({
      master,
      adapter,
      hooks: {
        onProvision: async () => {
          duringProvision = await r.resolveBySlug("acme").catch((e: unknown) => e);
        },
      },
    });
    await r.createTenant(BASE_INPUT);
    expect(duringProvision).toBeInstanceOf(TenantNotActiveError);
    await expect(r.resolveBySlug("acme")).resolves.toBeDefined();
    await r.shutdown();
  });

  it("honours an explicit initial status once provisioned", async () => {
    const r = await TenantRegistry.create({
      master,
      adapter,
      hooks: { onProvision: async () => {} },
    });
    const tenant = await r.createTenant({ ...BASE_INPUT, status: "suspended" });
    expect(tenant.status).toBe("suspended");
    await r.shutdown();
  });

  it("rolls back the master row when onProvision fails", async () => {
    const r = await TenantRegistry.create({
      master,
      adapter,
      hooks: {
        onProvision: async () => {
          throw new Error("CREATE DATABASE failed");
        },
      },
    });
    await expect(r.createTenant(BASE_INPUT)).rejects.toThrow("CREATE DATABASE failed");
    expect(await master.findBySlug("acme")).toBeNull();
    expect(adapter.connectCallCount).toBe(0);
    await r.shutdown();
  });

  it("rolls back and closes the connection when onCreate fails", async () => {
    const r = await TenantRegistry.create({
      master,
      adapter,
      hooks: {
        onCreate: async () => {
          throw new Error("migration failed");
        },
      },
    });
    await expect(r.createTenant(BASE_INPUT)).rejects.toThrow("migration failed");
    expect(await master.findBySlug("acme")).toBeNull();
    expect(adapter.connections[0]?.disconnected).toBe(true);
    await r.shutdown();
  });

  it("rolls back when the provisioning connection cannot be opened", async () => {
    adapter.connect = async () => {
      throw new Error("database does not exist");
    };
    const r = await TenantRegistry.create({
      master,
      adapter,
      hooks: { onCreate: async () => {} },
    });
    await expect(r.createTenant(BASE_INPUT)).rejects.toThrow("database does not exist");
    expect(await master.findBySlug("acme")).toBeNull();
    await r.shutdown();
  });
});
