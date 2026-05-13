import { runWithTenant } from "@kosan/core";
import type { TenantConfig, TenantContextValue } from "@kosan/core";
import { describe, expect, it } from "vitest";
import { useDrizzle } from "../src/context.js";
import type { DrizzleClientLike } from "../src/types.js";

const TENANT: TenantConfig = {
  id: "t-1",
  slug: "acme",
  host: "localhost",
  port: 5432,
  dbName: "acme_db",
  user: "u",
  password: "p",
  status: "active",
};

interface FakeClient extends DrizzleClientLike {
  query: (sql: string) => string[];
}

const fakeClient: FakeClient = {
  query: (sql) => [sql],
};

describe("useDrizzle", () => {
  it("returns the drizzle client from the current tenant context", () => {
    const ctx: TenantContextValue<FakeClient> = {
      tenant: TENANT,
      connection: fakeClient,
      models: { drizzle: fakeClient },
    };

    let client: FakeClient | undefined;

    runWithTenant(ctx, () => {
      client = useDrizzle<FakeClient>();
    });

    expect(client).toBe(fakeClient);
    expect(client?.query("SELECT 1")).toEqual(["SELECT 1"]);
  });

  it("throws when called outside of a tenant context", () => {
    expect(() => useDrizzle()).toThrow();
  });
});
