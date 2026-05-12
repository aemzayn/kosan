import type { Options as SequelizeOptions } from 'sequelize';

/**
 * Shape of `huni.config.ts` (or `.js` / `.mjs`).
 *
 * @example
 * ```ts
 * // huni.config.ts
 * import type { HuniConfig } from '@huni/cli';
 * export default {
 *   master: 'postgres://admin:pass@localhost/master',
 *   migrationsPath: './migrations',
 * } satisfies HuniConfig;
 * ```
 */
export interface HuniConfig {
  /** Connection string or Sequelize constructor options for the master DB. */
  master: string | SequelizeOptions;

  /** Glob or directory path for migration files relative to the config file. */
  migrationsPath: string;

  /**
   * Name of the table used to track which migrations have been applied.
   * Default: `"sequelize_meta"`
   */
  migrationsTableName?: string;

  /** Default concurrency for `huni migrate`. Can be overridden with --concurrency. */
  concurrency?: number;
}

// ---------------------------------------------------------------------------
// Per-tenant migration result
// ---------------------------------------------------------------------------

export type MigrationOutcome = 'migrated' | 'up-to-date' | 'failed' | 'skipped';

export interface TenantMigrationResult {
  tenantId: string;
  slug: string;
  outcome: MigrationOutcome;
  /** Names of migration files that were executed (empty for up-to-date). */
  applied: string[];
  error?: Error;
  durationMs: number;
}
