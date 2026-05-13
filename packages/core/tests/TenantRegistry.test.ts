import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TenantNotActiveError,
  TenantNotFoundError,
  TenantRegistry,
} from "../src/TenantRegistry.js";
import type { CreateTenantInput } from "../src/types.js";
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
      const ctx = await r.resolveBySlug("acme");
      expect(ctx.tenant.password).toBe("secret");
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
