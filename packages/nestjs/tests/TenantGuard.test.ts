import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { runWithTenant } from '@huni/core';
import type { TenantConfig, TenantContextValue } from '@huni/core';
import { TenantGuard } from '../src/TenantGuard.js';

const TENANT: TenantConfig = {
  id: 't-1',
  slug: 'acme',
  host: 'localhost',
  port: 5432,
  dbName: 'acme_db',
  user: 'u',
  password: 'p',
  status: 'active',
};

const CTX: TenantContextValue = { tenant: TENANT, connection: {}, models: {} };
const EXEC_CTX = {} as never;

describe('TenantGuard', () => {
  it('returns true when tenant context is set', () => {
    const guard = new TenantGuard();
    let result: boolean | undefined;

    runWithTenant(CTX, () => {
      result = guard.canActivate(EXEC_CTX);
    });

    expect(result).toBe(true);
  });

  it('throws UnauthorizedException when no tenant in context', () => {
    const guard = new TenantGuard();
    expect(() => guard.canActivate(EXEC_CTX)).toThrow(UnauthorizedException);
  });
});
