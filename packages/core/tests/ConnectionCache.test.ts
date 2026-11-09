import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionCache } from "../src/ConnectionCache.js";
import type { TenantConfig } from "../src/types.js";
import { FakeAdapter } from "./helpers/FakeAdapter.js";

function makeTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    id: "tenant-1",
    slug: "acme",
    host: "localhost",
    port: 5432,
    dbName: "acme_db",
    user: "acme",
    password: "secret",
    status: "active",
    ...overrides,
  };
}

describe("ConnectionCache", () => {
  let adapter: FakeAdapter;
  let cache: ConnectionCache<
    ReturnType<FakeAdapter["connect"]> extends Promise<infer T> ? T : never
  >;

  beforeEach(() => {
    adapter = new FakeAdapter();
    cache = new ConnectionCache(adapter, { idleTimeoutMs: 60_000 });
  });

  afterEach(async () => {
    await cache.disconnectAll();
    vi.useRealTimers();
  });

  it("connects on first access", async () => {
    const tenant = makeTenant();
    await cache.getOrConnect(tenant);
    expect(adapter.connectCallCount).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("returns the cached connection on subsequent calls", async () => {
    const tenant = makeTenant();
    const first = await cache.getOrConnect(tenant);
    const second = await cache.getOrConnect(tenant);
    expect(first).toBe(second);
    expect(adapter.connectCallCount).toBe(1);
  });

  it("evicts and disconnects a specific tenant", async () => {
    const tenant = makeTenant();
    const conn = await cache.getOrConnect(tenant);
    await cache.evict(tenant.id);
    expect(conn.disconnected).toBe(true);
    expect(cache.size).toBe(0);
  });

  it("is a no-op when evicting a non-existent tenant", async () => {
    await expect(cache.evict("missing")).resolves.toBeUndefined();
  });

  it("disconnects all entries on disconnectAll", async () => {
    const t1 = makeTenant({ id: "t1", slug: "a" });
    const t2 = makeTenant({ id: "t2", slug: "b" });
    await cache.getOrConnect(t1);
    await cache.getOrConnect(t2);
    await cache.disconnectAll();
    expect(adapter.disconnectCallCount).toBe(2);
    expect(cache.size).toBe(0);
  });

  it("evicts the least-recently-used entry when maxSize is reached", async () => {
    const smallCache = new ConnectionCache(adapter, { maxSize: 2, idleTimeoutMs: 60_000 });

    const t1 = makeTenant({ id: "t1", slug: "a" });
    const t2 = makeTenant({ id: "t2", slug: "b" });
    const t3 = makeTenant({ id: "t3", slug: "c" });

    const conn1 = await smallCache.getOrConnect(t1);
    await smallCache.getOrConnect(t2);
    // Access t1 to make t2 the LRU.
    await smallCache.getOrConnect(t1);
    // Adding t3 should evict t2 (LRU).
    await smallCache.getOrConnect(t3);

    expect(conn1.disconnected).toBe(false); // t1 survived
    expect(smallCache.has("t2")).toBe(false); // t2 was evicted
    expect(smallCache.has("t3")).toBe(true);
    await smallCache.disconnectAll();
  });

  it("evicts entry after idle timeout", async () => {
    vi.useFakeTimers();
    const tenant = makeTenant();
    await cache.getOrConnect(tenant);
    expect(cache.size).toBe(1);

    vi.advanceTimersByTime(60_001);
    await vi.runAllTimersAsync();

    expect(cache.size).toBe(0);
    expect(adapter.disconnectCallCount).toBe(1);
  });

  it("resets idle timer on cache hit", async () => {
    vi.useFakeTimers();
    const tenant = makeTenant();
    await cache.getOrConnect(tenant);

    // Advance to just before expiry (t=59s), then touch the entry.
    vi.advanceTimersByTime(59_000);
    await cache.getOrConnect(tenant); // cache hit — timer resets to t+60s

    // Advance another 59s (t=118s). Without the reset the entry would have
    // expired at t=60s; with it the new deadline is t=119s.
    vi.advanceTimersByTime(59_000);

    // Still alive — new deadline hasn't passed yet.
    expect(cache.size).toBe(1);
    await cache.disconnectAll();
  });

  it("returns cache stats", async () => {
    const tenant = makeTenant();
    await cache.getOrConnect(tenant);
    const stats = cache.stats();
    expect(stats).toHaveLength(1);
    expect(stats[0]?.tenantId).toBe("tenant-1");
    expect(typeof stats[0]?.lastUsed).toBe("number");
  });

  describe("connection settings changed elsewhere", () => {
    it("reconnects when the tenant's host changed (e.g. moved to another region)", async () => {
      const original = makeTenant();
      const first = await cache.getOrConnect(original);

      const moved = makeTenant({ host: "db.us.example.com" });
      const second = await cache.getOrConnect(moved);

      expect(second).not.toBe(first);
      expect(first.disconnected).toBe(true);
      expect(adapter.connectedWith.at(-1)?.host).toBe("db.us.example.com");
      expect(cache.size).toBe(1);
    });

    it("reconnects when credentials were rotated", async () => {
      const first = await cache.getOrConnect(makeTenant());
      const second = await cache.getOrConnect(makeTenant({ password: "rotated" }));
      expect(second).not.toBe(first);
      expect(adapter.connectCallCount).toBe(2);
    });

    it("keeps the connection when only non-connection fields change", async () => {
      const first = await cache.getOrConnect(makeTenant());
      const second = await cache.getOrConnect(
        makeTenant({ slug: "acme-renamed", meta: { plan: "pro" } }),
      );
      expect(second).toBe(first);
      expect(adapter.connectCallCount).toBe(1);
    });
  });

  describe("concurrent connects", () => {
    /** Adapter whose connect() stays pending until the test releases it. */
    function gatedAdapter() {
      const gate = new FakeAdapter();
      const releases: Array<() => void> = [];
      const failures: Array<(err: Error) => void> = [];
      const realConnect = gate.connect.bind(gate);
      gate.connect = (tenant: TenantConfig) =>
        new Promise((resolve, reject) => {
          releases.push(() => resolve(realConnect(tenant)));
          failures.push(reject);
        });
      return {
        adapter: gate,
        release: (i = 0) => releases[i]?.(),
        fail: (err: Error, i = 0) => failures[i]?.(err),
        pendingCount: () => releases.length,
      };
    }

    it("shares one in-flight connect between simultaneous requests", async () => {
      const gated = gatedAdapter();
      const c = new ConnectionCache(gated.adapter);
      const tenant = makeTenant();

      const results = Promise.all([
        c.getOrConnect(tenant),
        c.getOrConnect(tenant),
        c.getOrConnect(tenant),
      ]);
      expect(gated.pendingCount()).toBe(1);

      gated.release();
      const [a, b, d] = await results;
      expect(a).toBe(b);
      expect(b).toBe(d);
      expect(c.size).toBe(1);
      await c.disconnectAll();
    });

    it("does not cache a failed connect, so the next request retries", async () => {
      const gated = gatedAdapter();
      const c = new ConnectionCache(gated.adapter);
      const tenant = makeTenant();

      const first = c.getOrConnect(tenant);
      gated.fail(new Error("db down"));
      await expect(first).rejects.toThrow("db down");
      expect(c.size).toBe(0);

      const second = c.getOrConnect(tenant);
      expect(gated.pendingCount()).toBe(2);
      gated.release(1);
      await expect(second).resolves.toMatchObject({ tenantId: tenant.id });
      await c.disconnectAll();
    });

    it("never exceeds maxSize when different tenants connect at once", async () => {
      const gated = gatedAdapter();
      const c = new ConnectionCache(gated.adapter, { maxSize: 2 });

      const pending = ["t1", "t2", "t3"].map((id) => c.getOrConnect(makeTenant({ id, slug: id })));
      for (let i = 0; i < 3; i++) gated.release(i);
      await Promise.all(pending);

      expect(c.size).toBe(2);
      expect(gated.adapter.disconnectCallCount).toBe(1);
      await c.disconnectAll();
    });

    it("discards a connection whose tenant was evicted mid-connect", async () => {
      const gated = gatedAdapter();
      const c = new ConnectionCache(gated.adapter);
      const tenant = makeTenant();

      const inflight = c.getOrConnect(tenant);
      await c.evict(tenant.id); // e.g. credentials updated or tenant suspended
      gated.release();

      await expect(inflight).rejects.toThrow(/evicted/);
      expect(c.size).toBe(0);
      expect(gated.adapter.connections[0]?.disconnected).toBe(true);
    });
  });
});
