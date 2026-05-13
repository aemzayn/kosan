import { describe, expect, it, vi } from "vitest";
import { withConcurrency } from "../src/pool.js";

describe("withConcurrency", () => {
  it("processes all items and returns results in order", async () => {
    const results = await withConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(results).toEqual([10, 20, 30, 40]);
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;

    await withConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return n;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("handles concurrency greater than item count", async () => {
    const results = await withConcurrency([1, 2], 10, async (n) => n);
    expect(results).toEqual([1, 2]);
  });

  it("handles an empty array", async () => {
    const results = await withConcurrency([], 4, async (n: number) => n);
    expect(results).toEqual([]);
  });

  it("passes the index to fn", async () => {
    const indices: number[] = [];
    await withConcurrency(["a", "b", "c"], 1, async (_item, i) => {
      indices.push(i);
    });
    expect(indices).toEqual([0, 1, 2]);
  });

  it("propagates errors from fn", async () => {
    await expect(
      withConcurrency([1], 1, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("processes items with concurrency=1 serially", async () => {
    const order: number[] = [];
    await withConcurrency([1, 2, 3], 1, async (n) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(n);
    });
    expect(order).toEqual([1, 2, 3]);
  });
});
