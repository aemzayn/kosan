import { describe, it, expect, vi } from 'vitest';
import { HuniModule } from '../src/HuniModule.js';
import { HUNI_REGISTRY, HUNI_OPTIONS, HUNI_RESOLVER } from '../src/constants.js';
import { TenantMiddleware } from '../src/TenantMiddleware.js';
import { TenantGuard } from '../src/TenantGuard.js';

const fakeOptions = {
  master: {} as never,
  adapter: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getModels: vi.fn(() => ({})),
  },
  resolver: { resolve: () => null },
};

describe('HuniModule.forRoot', () => {
  it('returns a DynamicModule with the correct module class', () => {
    const mod = HuniModule.forRoot(fakeOptions);
    expect(mod.module).toBe(HuniModule);
  });

  it('exports HUNI_REGISTRY, HUNI_OPTIONS, HUNI_RESOLVER, TenantMiddleware, TenantGuard', () => {
    const mod = HuniModule.forRoot(fakeOptions);
    expect(mod.exports).toContain(HUNI_REGISTRY);
    expect(mod.exports).toContain(HUNI_OPTIONS);
    expect(mod.exports).toContain(HUNI_RESOLVER);
    expect(mod.exports).toContain(TenantMiddleware);
    expect(mod.exports).toContain(TenantGuard);
  });

  it('includes HUNI_REGISTRY provider with factory', () => {
    const mod = HuniModule.forRoot(fakeOptions);
    const providers = mod.providers as { provide: unknown; useFactory?: unknown }[];
    const registryProvider = providers.find((p) => p.provide === HUNI_REGISTRY);
    expect(registryProvider).toBeDefined();
    expect(registryProvider?.useFactory).toBeTypeOf('function');
  });
});

describe('HuniModule.forRootAsync', () => {
  it('returns a DynamicModule with async providers', () => {
    const mod = HuniModule.forRootAsync({
      useFactory: () => fakeOptions,
    });
    expect(mod.module).toBe(HuniModule);
    const providers = mod.providers as { provide: unknown }[];
    const optionsProvider = providers.find((p) => p.provide === HUNI_OPTIONS);
    expect(optionsProvider).toBeDefined();
  });

  it('includes imports when provided', () => {
    const FakeModule = class {};
    const mod = HuniModule.forRootAsync({
      imports: [FakeModule],
      useFactory: () => fakeOptions,
    });
    expect(mod.imports).toContain(FakeModule);
  });
});
