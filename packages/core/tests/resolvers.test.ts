import { describe, expect, it } from 'vitest';
import { HeaderResolver } from '../src/resolvers/HeaderResolver.js';
import { PathResolver } from '../src/resolvers/PathResolver.js';
import { SubdomainResolver } from '../src/resolvers/SubdomainResolver.js';

// ---------------------------------------------------------------------------
// SubdomainResolver
// ---------------------------------------------------------------------------

describe('SubdomainResolver', () => {
  const resolver = new SubdomainResolver();

  it('extracts the leftmost subdomain', () => {
    expect(resolver.resolve({ hostname: 'acme.myapp.com' })).toBe('acme');
  });

  it('returns null when there is no subdomain', () => {
    expect(resolver.resolve({ hostname: 'myapp.com' })).toBeNull();
    expect(resolver.resolve({ hostname: 'localhost' })).toBeNull();
  });

  it('falls back to the host header', () => {
    expect(resolver.resolve({ headers: { host: 'acme.myapp.com' } })).toBe('acme');
  });

  it('strips the port before splitting', () => {
    expect(resolver.resolve({ hostname: 'acme.myapp.com:3000' })).toBe('acme');
    expect(resolver.resolve({ headers: { host: 'acme.myapp.com:3000' } })).toBe('acme');
  });

  it('returns null when no hostname is available', () => {
    expect(resolver.resolve({})).toBeNull();
  });

  it('ignores www subdomain by default', () => {
    expect(resolver.resolve({ hostname: 'www.myapp.com' })).toBeNull();
  });

  it('respects custom ignoredSubdomains', () => {
    const r = new SubdomainResolver({ ignoredSubdomains: ['www', 'api'] });
    expect(r.resolve({ hostname: 'api.myapp.com' })).toBeNull();
    expect(r.resolve({ hostname: 'acme.myapp.com' })).toBe('acme');
  });
});

// ---------------------------------------------------------------------------
// HeaderResolver
// ---------------------------------------------------------------------------

describe('HeaderResolver', () => {
  const resolver = new HeaderResolver('X-Tenant-ID');

  it('reads the value from a matching header (case-insensitive)', () => {
    expect(resolver.resolve({ headers: { 'x-tenant-id': 'acme' } })).toBe('acme');
  });

  it('returns null when the header is missing', () => {
    expect(resolver.resolve({ headers: {} })).toBeNull();
    expect(resolver.resolve({})).toBeNull();
  });

  it('returns the first value when the header is an array', () => {
    expect(resolver.resolve({ headers: { 'x-tenant-id': ['acme', 'globex'] } })).toBe('acme');
  });
});

// ---------------------------------------------------------------------------
// PathResolver
// ---------------------------------------------------------------------------

describe('PathResolver', () => {
  const resolver = new PathResolver({ segment: 0 });

  it('extracts the first path segment', () => {
    expect(resolver.resolve({ path: '/acme/orders' })).toBe('acme');
    expect(resolver.resolve({ url: '/acme/orders' })).toBe('acme');
  });

  it('strips query string before splitting', () => {
    expect(resolver.resolve({ path: '/acme/orders?page=2' })).toBe('acme');
  });

  it('returns null for the root path', () => {
    expect(resolver.resolve({ path: '/' })).toBeNull();
  });

  it('returns null when path is missing', () => {
    expect(resolver.resolve({})).toBeNull();
  });

  it('uses the segment index to pick a later segment', () => {
    const second = new PathResolver({ segment: 1 });
    expect(second.resolve({ path: '/api/acme/orders' })).toBe('acme');
  });
});
