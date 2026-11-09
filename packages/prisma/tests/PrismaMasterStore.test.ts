import { randomUUID } from "node:crypto";
import type { CreateTenantInput } from "@kosan/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaMasterStore } from "../src/PrismaMasterStore.js";
import type { TenantDelegate, TenantRow } from "../src/types.js";

// ---------------------------------------------------------------------------
// In-memory delegate mock
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: randomUUID(),
    slug: "acme",
    host: "localhost",
    port: 5432,
    dbName: "acme_db",
    user: "acme_user",
    password: "secret",
    status: "active",
    meta: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDelegate(rows: TenantRow[] = []): TenantDelegate {
  const store = new Map<string, TenantRow>(rows.map((r) => [r.id, r]));

  return {
    findMany: vi.fn(async (args?: { where?: Partial<TenantRow> }) => {
      const all = [...store.values()];
      if (!args?.where) return all;
      return all.filter((r) =>
        Object.entries(args.where as Partial<TenantRow>).every(
          ([k, v]) => r[k as keyof TenantRow] === v,
        ),
      );
    }),
    findFirst: vi.fn(async (args: { where: Partial<TenantRow> }) => {
      return (
        [...store.values()].find((r) =>
          Object.entries(args.where).every(([k, v]) => r[k as keyof TenantRow] === v),
        ) ?? null
      );
    }),
    findUnique: vi.fn(async (args: { where: { id?: string; slug?: string } }) => {
      if (args.where.id) return store.get(args.where.id) ?? null;
      return [...store.values()].find((r) => r.slug === args.where.slug) ?? null;
    }),
    create: vi.fn(async (args: { data: Omit<TenantRow, "createdAt" | "updatedAt"> }) => {
      const row: TenantRow = { ...args.data, createdAt: new Date(), updatedAt: new Date() };
      store.set(row.id, row);
      return row;
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Partial<TenantRow> }) => {
      const existing = store.get(args.where.id);
      if (!existing) throw new Error(`Not found: ${args.where.id}`);
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      store.set(updated.id, updated);
      return updated;
    }),
    delete: vi.fn(async (args: { where: { id: string } }) => {
      const row = store.get(args.where.id);
      store.delete(args.where.id);
      if (!row) throw new Error(`Not found: ${args.where.id}`);
      return row;
    }),
  };
}

const BASE_INPUT: CreateTenantInput = {
  slug: "acme",
  host: "localhost",
  port: 5432,
  dbName: "acme_db",
  user: "acme_user",
  password: "secret",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PrismaMasterStore", () => {
  let delegate: TenantDelegate;
  let store: PrismaMasterStore;

  beforeEach(() => {
    delegate = makeDelegate();
    store = new PrismaMasterStore(delegate);
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe("create", () => {
    it("generates a UUID and persists the row", async () => {
      const tenant = await store.create(BASE_INPUT);
      expect(tenant.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(tenant.slug).toBe("acme");
      expect(tenant.status).toBe("active");
      expect(delegate.create).toHaveBeenCalledOnce();
    });

    it("uses a custom status when provided", async () => {
      const tenant = await store.create({ ...BASE_INPUT, status: "suspended" });
      expect(tenant.status).toBe("suspended");
    });

    it("stores meta", async () => {
      const tenant = await store.create({ ...BASE_INPUT, meta: { plan: "pro" } });
      expect(tenant.meta?.plan).toBe("pro");
    });

    it("maps null meta to undefined in TenantConfig", async () => {
      const tenant = await store.create(BASE_INPUT);
      expect(tenant.meta).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe("findAll", () => {
    it("returns all rows when no filter is given", async () => {
      delegate = makeDelegate([makeRow({ slug: "a" }), makeRow({ id: randomUUID(), slug: "b" })]);
      store = new PrismaMasterStore(delegate);
      const all = await store.findAll();
      expect(all).toHaveLength(2);
    });

    it("filters by status", async () => {
      delegate = makeDelegate([
        makeRow({ slug: "a", status: "active" }),
        makeRow({ id: randomUUID(), slug: "b", status: "suspended" }),
      ]);
      store = new PrismaMasterStore(delegate);
      const active = await store.findAll({ status: "active" });
      expect(active).toHaveLength(1);
      expect(active[0]?.slug).toBe("a");
    });

    it("calls findMany with no args when filter is omitted", async () => {
      await store.findAll();
      expect(delegate.findMany).toHaveBeenCalledWith(undefined);
    });
  });

  // -------------------------------------------------------------------------
  // findBySlug / findById
  // -------------------------------------------------------------------------

  describe("findBySlug", () => {
    it("returns the matching tenant", async () => {
      delegate = makeDelegate([makeRow({ slug: "acme" })]);
      store = new PrismaMasterStore(delegate);
      const found = await store.findBySlug("acme");
      expect(found?.slug).toBe("acme");
      expect(delegate.findUnique).toHaveBeenCalledWith({ where: { slug: "acme" } });
    });

    it("returns null for an unknown slug", async () => {
      expect(await store.findBySlug("nope")).toBeNull();
    });
  });

  describe("findById", () => {
    it("returns the matching tenant", async () => {
      const row = makeRow();
      delegate = makeDelegate([row]);
      store = new PrismaMasterStore(delegate);
      const found = await store.findById(row.id);
      expect(found?.id).toBe(row.id);
      expect(delegate.findUnique).toHaveBeenCalledWith({ where: { id: row.id } });
    });

    it("returns null for an unknown id", async () => {
      expect(await store.findById("missing")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe("update", () => {
    it("updates mutable fields", async () => {
      const row = makeRow();
      delegate = makeDelegate([row]);
      store = new PrismaMasterStore(delegate);
      const updated = await store.update(row.id, { host: "newhost", port: 5433 });
      expect(updated.host).toBe("newhost");
      expect(updated.port).toBe(5433);
      expect(delegate.update).toHaveBeenCalledWith({
        where: { id: row.id },
        data: { host: "newhost", port: 5433 },
      });
    });

    it("only sends defined fields to the delegate", async () => {
      const row = makeRow();
      delegate = makeDelegate([row]);
      store = new PrismaMasterStore(delegate);
      await store.update(row.id, { status: "suspended" });
      const call = vi.mocked(delegate.update).mock.calls[0]?.[0];
      expect(call?.data).toEqual({ status: "suspended" });
    });

    it("propagates errors from the delegate", async () => {
      await expect(store.update("bad-id", { host: "x" })).rejects.toThrow("Not found");
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe("delete", () => {
    it("calls delegate.delete with the correct id", async () => {
      const row = makeRow();
      delegate = makeDelegate([row]);
      store = new PrismaMasterStore(delegate);
      await store.delete(row.id);
      expect(delegate.delete).toHaveBeenCalledWith({ where: { id: row.id } });
    });
  });
});
