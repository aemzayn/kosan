import type { QueryInterface, Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import type { TenantMigrationResult, KosanConfig } from './types.js';
import type { TenantConfig } from '@kosan/core';

// ---------------------------------------------------------------------------
// Public migration shape — what callers provide to the runner
// ---------------------------------------------------------------------------

export interface Migration {
  name: string;
  up: (qi: QueryInterface) => Promise<void>;
  down: (qi: QueryInterface) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Runner — pure orchestration, no I/O
// ---------------------------------------------------------------------------

export interface RunMigrationOptions {
  tenant: TenantConfig;
  sequelize: Sequelize;
  config: Pick<KosanConfig, 'migrationsTableName'>;
  migrations: Migration[];
}

/**
 * Runs pending migrations for a single tenant using umzug + SequelizeStorage.
 * Always resolves — errors are captured in the result object.
 */
export async function runMigrationsForTenant(
  opts: RunMigrationOptions,
): Promise<TenantMigrationResult> {
  const { tenant, sequelize, config, migrations } = opts;
  const start = Date.now();

  try {
    const qi = sequelize.getQueryInterface();

    const umzug = new Umzug({
      migrations: migrations.map((m) => ({
        name: m.name,
        up: async () => m.up(qi),
        down: async () => m.down(qi),
      })),
      context: qi,
      storage: new SequelizeStorage({
        sequelize,
        tableName: config.migrationsTableName ?? 'sequelize_meta',
      }),
      logger: undefined,
    });

    const pending = await umzug.pending();
    if (pending.length === 0) {
      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        outcome: 'up-to-date',
        applied: [],
        durationMs: Date.now() - start,
      };
    }

    const executed = await umzug.up();
    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      outcome: 'migrated',
      applied: executed.map((m) => m.name),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      outcome: 'failed',
      applied: [],
      error: err instanceof Error ? err : new Error(String(err)),
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Migration file loader — used by the CLI; separated so tests can bypass it
// ---------------------------------------------------------------------------

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MIGRATION_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);

interface MigrationModule {
  up?: (qi: QueryInterface, sq: typeof Sequelize) => Promise<void>;
  down?: (qi: QueryInterface, sq: typeof Sequelize) => Promise<void>;
  default?: {
    up?: (qi: QueryInterface, sq: typeof Sequelize) => Promise<void>;
    down?: (qi: QueryInterface, sq: typeof Sequelize) => Promise<void>;
  };
}

/**
 * Reads all migration files from `dir`, sorted alphabetically, and returns
 * them as `Migration` objects with lazy dynamic imports.
 */
export function loadMigrationsFromDir(dir: string, SeqConstructor: typeof Sequelize): Migration[] {
  const files = readdirSync(dir)
    .filter((f) => MIGRATION_EXTENSIONS.has(path.extname(f)))
    .sort();

  return files.map((file) => {
    const fileUrl = pathToFileURL(path.join(dir, file)).href;
    return {
      name: file,
      up: async (qi: QueryInterface) => {
        const mod = await import(fileUrl) as MigrationModule;
        const fn = mod.up ?? mod.default?.up;
        if (typeof fn !== 'function') throw new Error(`Migration "${file}" has no up() export`);
        await fn(qi, SeqConstructor);
      },
      down: async (qi: QueryInterface) => {
        const mod = await import(fileUrl) as MigrationModule;
        const fn = mod.down ?? mod.default?.down;
        if (typeof fn !== 'function') throw new Error(`Migration "${file}" has no down() export`);
        await fn(qi, SeqConstructor);
      },
    };
  });
}
