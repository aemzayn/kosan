/**
 * Run once after `docker-compose up` to create the three demo tenants.
 *
 *   pnpm provision
 */
import { registry } from './registry.js';

const tenants = [
  {
    slug: 'acme',
    host: 'localhost',
    port: 5433,
    dbName: 'acme_db',
    user: 'acme_user',
    password: 'acme_pass',
    meta: { plan: 'pro' },
  },
  {
    slug: 'globex',
    host: 'localhost',
    port: 5434,
    dbName: 'globex_db',
    user: 'globex_user',
    password: 'globex_pass',
    meta: { plan: 'starter' },
  },
  {
    slug: 'initech',
    host: 'localhost',
    port: 5435,
    dbName: 'initech_db',
    user: 'initech_user',
    password: 'initech_pass',
    meta: { plan: 'starter' },
  },
];

for (const input of tenants) {
  const existing = await registry.listTenants().then((all) =>
    all.find((t) => t.slug === input.slug),
  );
  if (existing !== undefined) {
    console.log(`[skip] tenant "${input.slug}" already exists`);
    continue;
  }
  await registry.createTenant(input);
  console.log(`[ok] created tenant "${input.slug}"`);
}

await registry.shutdown();
process.exit(0);
