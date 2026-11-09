import type { Sequelize } from "sequelize";

/** A model factory receives a Sequelize instance and returns a model. */
export type SequelizeModelFactory = (sequelize: Sequelize) => unknown;

export interface SlowQueryInfo {
  sql: string;
  durationMs: number;
  tenantId: string;
  tenantSlug: string;
}

export interface SequelizeAdapterOptions {
  /**
   * Default Sequelize dialect used when a tenant row does not carry one.
   * The tenant's actual dialect is derived from its `host` / `dbName` config;
   * this is the fallback.
   */
  defaultDialect?: "postgres" | "mysql" | "mariadb" | "sqlite" | "mssql";

  /** Sequelize pool options applied to every tenant connection. */
  pool?: {
    max?: number;
    min?: number;
    acquire?: number;
    idle?: number;
  };

  /** Extra Sequelize constructor options forwarded verbatim. */
  dialectOptions?: Record<string, unknown>;

  /** When true, Sequelize logs all SQL. Default: false. */
  logging?: boolean | ((sql: string, timing?: number) => void);

  /** Called when a query exceeds `slowQueryThresholdMs`. */
  onSlowQuery?: (info: SlowQueryInfo) => void;

  /** Queries taking longer than this (ms) trigger `onSlowQuery`. Default: 1000 */
  slowQueryThresholdMs?: number;
}
