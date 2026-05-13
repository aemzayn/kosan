import { describe, expect, it, vi } from "vitest";
import { KosanModule } from "../src/KosanModule.js";
import { TenantGuard } from "../src/TenantGuard.js";
import { TenantMiddleware } from "../src/TenantMiddleware.js";
import { KOSAN_OPTIONS, KOSAN_REGISTRY, KOSAN_RESOLVER } from "../src/constants.js";

const fakeOptions = {
  master: {} as never,
  adapter: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getModels: vi.fn(() => ({})),
  },
  resolver: { resolve: () => null },
};

describe("KosanModule.forRoot", () => {
  it("returns a DynamicModule with the correct module class", () => {
    const mod = KosanModule.forRoot(fakeOptions);
    expect(mod.module).toBe(KosanModule);
  });

  it("exports KOSAN_REGISTRY, KOSAN_OPTIONS, KOSAN_RESOLVER, TenantMiddleware, TenantGuard", () => {
    const mod = KosanModule.forRoot(fakeOptions);
    expect(mod.exports).toContain(KOSAN_REGISTRY);
    expect(mod.exports).toContain(KOSAN_OPTIONS);
    expect(mod.exports).toContain(KOSAN_RESOLVER);
    expect(mod.exports).toContain(TenantMiddleware);
    expect(mod.exports).toContain(TenantGuard);
  });

  it("includes KOSAN_REGISTRY provider with factory", () => {
    const mod = KosanModule.forRoot(fakeOptions);
    const providers = mod.providers as { provide: unknown; useFactory?: unknown }[];
    const registryProvider = providers.find((p) => p.provide === KOSAN_REGISTRY);
    expect(registryProvider).toBeDefined();
    expect(registryProvider?.useFactory).toBeTypeOf("function");
  });
});

describe("KosanModule.forRootAsync", () => {
  it("returns a DynamicModule with async providers", () => {
    const mod = KosanModule.forRootAsync({
      useFactory: () => fakeOptions,
    });
    expect(mod.module).toBe(KosanModule);
    const providers = mod.providers as { provide: unknown }[];
    const optionsProvider = providers.find((p) => p.provide === KOSAN_OPTIONS);
    expect(optionsProvider).toBeDefined();
  });

  it("includes imports when provided", () => {
    const FakeModule = class {};
    const mod = KosanModule.forRootAsync({
      imports: [FakeModule],
      useFactory: () => fakeOptions,
    });
    expect(mod.imports).toContain(FakeModule);
  });
});
