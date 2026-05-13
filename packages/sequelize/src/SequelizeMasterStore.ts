import { randomUUID } from "node:crypto";
import type {
  CreateTenantInput,
  MasterStore,
  TenantConfig,
  TenantStatus,
  UpdateTenantInput,
} from "@kosan/core";
import {
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
  type Sequelize,
} from "sequelize";

// ---------------------------------------------------------------------------
// Internal Sequelize model — not exported; users interact via MasterStore API
// ---------------------------------------------------------------------------

class TenantModel extends Model<
  InferAttributes<TenantModel>,
  InferCreationAttributes<TenantModel>
> {
  declare id: string;
  declare slug: string;
  declare host: string;
  declare port: number;
  declare dbName: string;
  declare user: string;
  declare password: string;
  declare status: TenantStatus;
  declare meta: Record<string, unknown> | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

function defineTenantModel(sequelize: Sequelize): typeof TenantModel {
  TenantModel.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: () => randomUUID(),
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      host: { type: DataTypes.STRING(255), allowNull: false },
      port: { type: DataTypes.INTEGER, allowNull: false },
      dbName: { type: DataTypes.STRING(255), allowNull: false },
      user: { type: DataTypes.STRING(255), allowNull: false },
      password: { type: DataTypes.TEXT, allowNull: false },
      status: {
        type: DataTypes.ENUM("active", "suspended", "deleted"),
        allowNull: false,
        defaultValue: "active",
      },
      meta: { type: DataTypes.JSON, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: "tenants",
      modelName: "Tenant",
      underscored: true,
    },
  );
  return TenantModel;
}

function toConfig(row: TenantModel): TenantConfig {
  return {
    id: row.id,
    slug: row.slug,
    host: row.host,
    port: row.port,
    dbName: row.dbName,
    user: row.user,
    password: row.password,
    status: row.status,
    meta: row.meta ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Public class
// ---------------------------------------------------------------------------

export class SequelizeMasterStore implements MasterStore {
  private readonly model: typeof TenantModel;

  private constructor(model: typeof TenantModel) {
    this.model = model;
  }

  /**
   * Creates a `SequelizeMasterStore` backed by the given Sequelize connection.
   * Syncs the `tenants` table (creates if missing) before returning.
   *
   * Pass `{ alter: true }` to run non-destructive column migrations.
   */
  static async create(
    sequelize: Sequelize,
    syncOptions: { alter?: boolean; force?: boolean } = {},
  ): Promise<SequelizeMasterStore> {
    const model = defineTenantModel(sequelize);
    await model.sync(syncOptions);
    return new SequelizeMasterStore(model);
  }

  async findAll(filter?: { status?: TenantStatus }): Promise<TenantConfig[]> {
    const rows = await this.model.findAll({
      where: filter?.status !== undefined ? { status: filter.status } : undefined,
    });
    return rows.map(toConfig);
  }

  async findBySlug(slug: string): Promise<TenantConfig | null> {
    const row = await this.model.findOne({ where: { slug } });
    return row !== null ? toConfig(row) : null;
  }

  async findById(id: string): Promise<TenantConfig | null> {
    const row = await this.model.findByPk(id);
    return row !== null ? toConfig(row) : null;
  }

  async create(data: CreateTenantInput): Promise<TenantConfig> {
    const row = await this.model.create({
      id: randomUUID(),
      slug: data.slug,
      host: data.host,
      port: data.port,
      dbName: data.dbName,
      user: data.user,
      password: data.password,
      status: data.status ?? "active",
      meta: data.meta ?? null,
    });
    return toConfig(row);
  }

  async update(id: string, data: UpdateTenantInput): Promise<TenantConfig> {
    const row = await this.model.findByPk(id);
    if (row === null) throw new Error(`Tenant not found: ${id}`);
    await row.update(data);
    return toConfig(row);
  }

  async delete(id: string): Promise<void> {
    await this.model.destroy({ where: { id } });
  }
}
