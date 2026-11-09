import { describe, expect, it } from "vitest";
import { ConnectionCache } from "../src/ConnectionCache.js";
import type { Adapter, TenantConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// A fake adapter whose connect/disconnect stay pending until released, so a
// test can force the exact interleavings that used to break the cache.
// ---------------------------------------------------------------------------

interface Conn {
  id: number;
  tenantId: string;
  host: string;
  closed: number;
}

class SlowAdapter implements Adapter<Conn> {
  readonly opened: Conn[] = [];
  private next = 1;
  private readonly gates: Array<() => void> = [];
  /** When true, disconnect() waits for releaseDisconnects(). */
  holdDisconnects = false;
  /** Random delays (ms) for the stress test; 0 = resolve on next tick. */
  delay: () => number = () => 0;

  async connect(tenant: TenantConfig): Promise<Conn> {
    await sleep(this.delay());
    const conn = { id: this.next++, tenantId: tenant.id, host: tenant.host, closed: 0 };
    this.opened.push(conn);
    return conn;
  }

  async disconnect(conn: Conn): Promise<void> {
    if (this.holdDisconnects) await new Promise<void>((resolve) => this.gates.push(resolve));
    await sleep(this.delay());
    conn.closed++;
  }

  getModels(): Record<string, unknown> {
    return {};
  }

  releaseDisconnects(): void {
    this.holdDisconnects = false;
    for (const release of this.gates.splice(0)) release();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tenant(id: string, host = "db1"): TenantConfig {
  return {
    id,
    slug: id,
    host,
    port: 5432,
    dbName: id,
    user: "u",
    password: "p",
    status: "active",
  };
}

/** Every connection is either the single live one for its tenant, or closed exactly once. */
async function expectNoLeaks(cache: ConnectionCache<Conn>, adapter: SlowAdapter): Promise<void> {
  await sleep(10); // let background closes of replaced connections finish
  const live = new Map<string, Conn>();
  for (const id of new Set(adapter.opened.map((c) => c.tenantId))) {
    if (cache.has(id)) live.set(id, await cache.getOrConnect(tenant(id, liveHost(adapter, id))));
  }
  for (const conn of adapter.opened) {
    const isLive = live.get(conn.tenantId) === conn;
    expect(conn.closed, `conn ${conn.id} (${conn.tenantId})`).toBe(isLive ? 0 : 1);
  }
}

function liveHost(adapter: SlowAdapter, tenantId: string): string {
  const open = adapter.opened.filter((c) => c.tenantId === tenantId && c.closed === 0);
  return open.at(-1)?.host ?? "db1";
}

describe("ConnectionCache race conditions", () => {
  it("does not open a second connection while capacity eviction is closing another", async () => {
    const adapter = new SlowAdapter();
    const cache = new ConnectionCache(adapter, { maxSize: 1 });
    await cache.getOrConnect(tenant("t0"));

    adapter.holdDisconnects = true; // closing t0 to make room takes a while
    const first = cache.getOrConnect(tenant("t1"));
    await sleep(5); // t1's connect has finished; t0 is being closed
    const second = cache.getOrConnect(tenant("t1"));
    adapter.releaseDisconnects();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(adapter.opened.filter((c) => c.tenantId === "t1")).toHaveLength(1);
    expect(cache.size).toBe(1);
    await expectNoLeaks(cache, adapter);
    await cache.disconnectAll();
  });

  it("does not open a second connection while a stale one is being replaced", async () => {
    const adapter = new SlowAdapter();
    const cache = new ConnectionCache(adapter);
    await cache.getOrConnect(tenant("t1", "old-host"));

    adapter.holdDisconnects = true; // closing the stale connection takes a while
    const first = cache.getOrConnect(tenant("t1", "new-host"));
    const second = cache.getOrConnect(tenant("t1", "new-host"));
    adapter.releaseDisconnects();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(adapter.opened.filter((c) => c.host === "new-host")).toHaveLength(1);
    await expectNoLeaks(cache, adapter);
    await cache.disconnectAll();
  });

  it("an idle timer from a replaced connection never evicts its successor", async () => {
    const adapter = new SlowAdapter();
    const cache = new ConnectionCache(adapter, { idleTimeoutMs: 30 });
    await cache.getOrConnect(tenant("t1", "old-host"));
    await sleep(20);
    const fresh = await cache.getOrConnect(tenant("t1", "new-host"));
    await sleep(15); // old timer would have fired here
    expect(cache.has("t1")).toBe(true);
    expect(await cache.getOrConnect(tenant("t1", "new-host"))).toBe(fresh);
    await cache.disconnectAll();
  });

  it("disconnectAll waits for connections that are still opening", async () => {
    const adapter = new SlowAdapter();
    adapter.delay = () => 20;
    const cache = new ConnectionCache(adapter);
    const pending = cache.getOrConnect(tenant("t1"));
    await sleep(5);

    await cache.disconnectAll();
    await expect(pending).rejects.toThrow(/evicted/);
    expect(adapter.opened).toHaveLength(1);
    expect(adapter.opened[0]?.closed).toBe(1);
  });

  it("survives a randomized storm of concurrent requests, moves and evictions", async () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const adapter = new SlowAdapter();
    adapter.delay = () => Math.floor(random() * 4);
    const maxSize = 3;
    const cache = new ConnectionCache(adapter, { maxSize });
    const ids = ["t1", "t2", "t3", "t4", "t5"];
    const hosts = ["db1", "db2"];

    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 400; i++) {
      const id = ids[Math.floor(random() * ids.length)] ?? "t1";
      const host = hosts[Math.floor(random() * hosts.length)] ?? "db1";
      const op =
        random() < 0.1 ? cache.evict(id) : cache.getOrConnect(tenant(id, host)).catch(() => {});
      ops.push(op);
      if (i % 7 === 0) await sleep(1);
      expect(cache.size).toBeLessThanOrEqual(maxSize);
    }
    await Promise.all(ops);
    expect(cache.size).toBeLessThanOrEqual(maxSize);

    await cache.disconnectAll();
    for (const conn of adapter.opened) {
      expect(conn.closed, `conn ${conn.id} (${conn.tenantId}@${conn.host})`).toBe(1);
    }
  }, 20_000);
});
