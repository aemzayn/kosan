import path from 'node:path';
import { Sequelize } from 'sequelize';
import { SequelizeMasterStore, SequelizeAdapter } from '@huni/sequelize';
import { TenantRegistry } from '@huni/core';
import { withConcurrency } from '../pool.js';
import { loadMigrationsFromDir, runMigrationsForTenant } from '../runner.js';
import type { HuniConfig, TenantMigrationResult } from '../types.js';

export interface MigrateOptions {
  config: HuniConfig;
  /** Absolute path to the directory containing migration files. */
  migrationsDir: string;
  /** Max parallel tenant migrations. */
  concurrency: number;
  /** When set, only migrate this tenant slug. */
  tenant?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export async function runMigrate(opts: MigrateOptions): Promise<TenantMigrationResult[]> {
  const { config, migrationsDir, concurrency, logger } = opts;
  const log = logger ?? console;

  // ---------------------------------------------------------------------------
  // Bootstrap master DB + registry
  // ---------------------------------------------------------------------------

  const masterSequelize =
    typeof config.master === 'string'
      ? new Sequelize(config.master, { logging: false })
      : new Sequelize({ ...(config.master as object), logging: false } as ConstructorParameters<typeof Sequelize>[0]);

  const masterStore = await SequelizeMasterStore.create(masterSequelize);
  const adapter = new SequelizeAdapter({ logging: false });
  const registry = await TenantRegistry.create({ master: masterStore, adapter });

  try {
    // ---------------------------------------------------------------------------
    // Tenant selection
    // ---------------------------------------------------------------------------

    const allTenants = await registry.listTenants({ status: 'active' });

    const targets =
      opts.tenant !== undefined
        ? allTenants.filter((t) => t.slug === opts.tenant)
        : allTenants;

    if (targets.length === 0) {
      if (opts.tenant !== undefined) {
        log.warn(`No active tenant found with slug "${opts.tenant}". Nothing to migrate.`);
      } else {
        log.warn('No active tenants found. Nothing to migrate.');
      }
      return [];
    }

    // Load migration file list once — shared across all tenants.
    const migrations = loadMigrationsFromDir(migrationsDir, Sequelize);

    log.info(`Migrating ${targets.length} tenant(s) with concurrency=${concurrency}…`);

    // ---------------------------------------------------------------------------
    // Run migrations in parallel (bounded by concurrency)
    // ---------------------------------------------------------------------------

    const results = await withConcurrency(targets, concurrency, async (tenant) => {
      const dialect = (tenant.meta?.['dialect'] as string | undefined) ?? 'postgres';
      const isSqlite = dialect === 'sqlite';

      const sequelize = new Sequelize({
        dialect: dialect as 'postgres' | 'mysql' | 'sqlite' | 'mariadb' | 'mssql',
        ...(isSqlite
          ? { storage: tenant.dbName }
          : {
              host: tenant.host,
              port: tenant.port,
              database: tenant.dbName,
              username: tenant.user,
              password: tenant.password,
            }),
        logging: false,
      });

      try {
        await sequelize.authenticate();
        return await runMigrationsForTenant({ tenant, sequelize, config, migrations });
      } finally {
        await sequelize.close();
      }
    });

    return results;
  } finally {
    await registry.shutdown();
    await masterSequelize.close();
  }
}

// ---------------------------------------------------------------------------
// Pretty-print results to stdout
// ---------------------------------------------------------------------------

export function printResults(results: TenantMigrationResult[], logger = console): void {
  const pad = Math.max(...results.map((r) => r.slug.length), 4);
  const total = results.length;
  const migrated = results.filter((r) => r.outcome === 'migrated').length;
  const upToDate = results.filter((r) => r.outcome === 'up-to-date').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;

  logger.info('');
  logger.info('─'.repeat(60));
  logger.info(`${'TENANT'.padEnd(pad)}  OUTCOME     APPLIED  DURATION`);
  logger.info('─'.repeat(60));

  for (const r of results) {
    const icon =
      r.outcome === 'migrated' ? '✓' :
      r.outcome === 'up-to-date' ? '·' :
      r.outcome === 'failed' ? '✗' : '–';
    const appliedStr = String(r.applied.length);
    logger.info(
      `${r.slug.padEnd(pad)}  ${icon} ${r.outcome.padEnd(10)}  ${appliedStr.padStart(7)}  ${r.durationMs}ms`,
    );
    if (r.outcome === 'failed' && r.error !== undefined) {
      logger.error(`  ↳ ${r.error.message}`);
    }
  }

  logger.info('─'.repeat(60));
  logger.info(
    `Total: ${total}  migrated: ${migrated}  up-to-date: ${upToDate}  failed: ${failed}  skipped: ${skipped}`,
  );
  logger.info('');
}
