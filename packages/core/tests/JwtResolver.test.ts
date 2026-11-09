import { describe, expect, it, vi } from "vitest";
import { JwtResolver } from "../src/resolvers/JwtResolver.js";

/** Test "verifier": tokens look like `valid:<json payload>`; anything else fails. */
async function fakeVerify(token: string): Promise<Record<string, unknown>> {
  if (!token.startsWith("valid:")) throw new Error("bad signature");
  return JSON.parse(token.slice("valid:".length)) as Record<string, unknown>;
}

function bearer(payload: Record<string, unknown>): { headers: Record<string, string> } {
  return { headers: { authorization: `Bearer valid:${JSON.stringify(payload)}` } };
}

describe("JwtResolver", () => {
  it("returns the configured claim from a verified bearer token", async () => {
    const r = new JwtResolver({ verify: fakeVerify, claim: "tenant" });
    await expect(r.resolve(bearer({ tenant: "acme", sub: "u1" }))).resolves.toBe("acme");
  });

  it("passes only the raw token to verify()", async () => {
    const verify = vi.fn(fakeVerify);
    const r = new JwtResolver({ verify, claim: "tenant" });
    await r.resolve(bearer({ tenant: "acme" }));
    expect(verify).toHaveBeenCalledWith('valid:{"tenant":"acme"}');
  });

  it("accepts a function for nested or computed claims", async () => {
    const r = new JwtResolver({
      verify: fakeVerify,
      claim: (payload) => {
        const org = payload.org;
        return typeof org === "object" && org !== null && "slug" in org ? org.slug : null;
      },
    });
    await expect(r.resolve(bearer({ org: { slug: "globex" } }))).resolves.toBe("globex");
  });

  it("returns null when verification fails — an unverified token never selects a tenant", async () => {
    const r = new JwtResolver({ verify: fakeVerify, claim: "tenant" });
    const req = {
      headers: { authorization: `Bearer forged:${JSON.stringify({ tenant: "acme" })}` },
    };
    await expect(r.resolve(req)).resolves.toBeNull();
  });

  it("returns null without a token or with a non-bearer scheme", async () => {
    const r = new JwtResolver({ verify: fakeVerify, claim: "tenant" });
    await expect(r.resolve({ headers: {} })).resolves.toBeNull();
    await expect(r.resolve({})).resolves.toBeNull();
    await expect(
      r.resolve({ headers: { authorization: "Basic dXNlcjpwdw==" } }),
    ).resolves.toBeNull();
  });

  it("returns null when the claim is missing or not a non-empty string", async () => {
    const r = new JwtResolver({ verify: fakeVerify, claim: "tenant" });
    await expect(r.resolve(bearer({ sub: "u1" }))).resolves.toBeNull();
    await expect(r.resolve(bearer({ tenant: 42 }))).resolves.toBeNull();
    await expect(r.resolve(bearer({ tenant: "" }))).resolves.toBeNull();
  });

  it("matches the Bearer scheme case-insensitively", async () => {
    const r = new JwtResolver({ verify: fakeVerify, claim: "tenant" });
    const req = {
      headers: { authorization: `bearer valid:${JSON.stringify({ tenant: "acme" })}` },
    };
    await expect(r.resolve(req)).resolves.toBe("acme");
  });

  it("can read the raw token from a custom header", async () => {
    const r = new JwtResolver({ verify: fakeVerify, claim: "tenant", header: "X-Tenant-Token" });
    const req = { headers: { "x-tenant-token": `valid:${JSON.stringify({ tenant: "initech" })}` } };
    await expect(r.resolve(req)).resolves.toBe("initech");
  });
});
