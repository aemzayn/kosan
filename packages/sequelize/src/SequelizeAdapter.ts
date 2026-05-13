import type { Adapter, ModelFactory, TenantConfig } from "@kosan/core";
import { Sequelize } from "sequelize";
import type {
  SequelizeAdapterOptions,
  SequelizeModelFactory,
  SlowQueryInfo,
} from "./types.js";

export class SequelizeAdapter implements Adapter<Sequelize> {
  private readonly options: SequelizeAdapterOptions;
  private factories: SequelizeModelFactory[] = [];

  constructor(options: SequelizeAdapterOptions = {}) {
    this.options = options;
  }

  async connect(tenant: TenantConfig): Promise<Sequelize> {
    const logging = this.buildLogging(tenant);

    const sequelize = new Sequelize({
      dialect:
        (tenant.meta?.dialect as SequelizeAdapterOptions["defaultDialect"]) ??
        this.options.defaultDialect ??
        "postgres",
      host: tenant.host,
      port: tenant.port,
      database: tenant.dbName,
      username: tenant.user,
      password: tenant.password,
      pool: {
        max: this.options.pool?.max ?? 5,
        min: this.options.pool?.min ?? 0,
        acquire: this.options.pool?.acquire ?? 30_000,
        idle: this.options.pool?.idle ?? 10_000,
      },
      ...(this.options.dialectOptions !== undefined
        ? { dialectOptions: this.options.dialectOptions }
        : {}),
      logging,
      benchmark: this.options.onSlowQuery !== undefined,
    });

    await sequelize.authenticate();

    // Apply all registered model factories. Each factory calls sequelize.define()
    // which registers the model on this Sequelize instance automatically.
    for (const factory of this.factories) {
      factory(sequelize);
    }

    return sequelize;
  }

  async disconnect(sequelize: Sequelize): Promise<void> {
    await sequelize.close();
  }

  getModels(sequelize: Sequelize): Record<string, unknown> {
    // Sequelize exposes `.models` — a record of all defined models on this instance.
    return sequelize.models as Record<string, unknown>;
  }

  registerModelFactories(factories: ModelFactory<Sequelize>[]): void {
    this.factories = factories;
  }

  private buildLogging(tenant: TenantConfig): boolean | ((sql: string, timing?: number) => void) {
    const { onSlowQuery, slowQueryThresholdMs = 1000, logging } = this.options;

    if (onSlowQuery === undefined) {
      return logging ?? false;
    }

    // benchmark: true makes Sequelize pass timing (ms) as the second argument.
    return (sql: string, timing?: number) => {
      if (logging !== false && logging !== undefined) {
        if (typeof logging === "function") {
          logging(sql, timing);
        } else if (logging === true) {
          console.log(sql);
        }
      }
      if (timing !== undefined && timing >= slowQueryThresholdMs) {
        const info: SlowQueryInfo = {
          sql,
          durationMs: timing,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
        };
        onSlowQuery(info);
      }
    };
  }
}
