import { randomUUID } from "node:crypto";
import type {
  CreateTenantInput,
  MasterStore,
  TenantConfig,
  TenantStatus,
  UpdateTenantInput,
} from "@kosan/core";
import type { TenantDelegate, TenantRow } from "./types.js";

function toConfig(row: TenantRow): TenantConfig {
  return {
    id: row.id,
    slug: row.slug,
    host: row.host,
    port: row.port,
    dbName: row.dbName,
    user: row.user,
    password: row.password,
    status: row.status,
    ...(row.meta !== null && row.meta !== undefined ? { meta: row.meta } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * `MasterStore` implementation backed by a Prisma client delegate.
 *
 * Pass `prisma.tenant` (or whatever model name you chose):
 *
 * ```ts
 * import { PrismaClient } from '@prisma/client';
 * const prisma = new PrismaClient();
 * const store = new PrismaMasterStore(prisma.tenant);
 * ```
 *
 * The Prisma schema required for this store is documented on the
 * `TenantDelegate` type in `@kosan/prisma`.
 */
export class PrismaMasterStore implements MasterStore {
  private readonly delegate: TenantDelegate;

  constructor(delegate: TenantDelegate) {
    this.delegate = delegate;
  }

  async findAll(filter?: { status?: TenantStatus }): Promise<TenantConfig[]> {
    const rows = await this.delegate.findMany(
      filter?.status !== undefined ? { where: { status: filter.status } } : undefined,
    );
    return rows.map(toConfig);
  }

  async findBySlug(slug: string): Promise<TenantConfig | null> {
    const row = await this.delegate.findUnique({ where: { slug } });
    return row !== null ? toConfig(row) : null;
  }

  async findById(id: string): Promise<TenantConfig | null> {
    const row = await this.delegate.findUnique({ where: { id } });
    return row !== null ? toConfig(row) : null;
  }

  async create(data: CreateTenantInput): Promise<TenantConfig> {
    const row = await this.delegate.create({
      data: {
        id: randomUUID(),
        slug: data.slug,
        host: data.host,
        port: data.port,
        dbName: data.dbName,
        user: data.user,
        password: data.password,
        status: data.status ?? "active",
        meta: data.meta ?? null,
      },
    });
    return toConfig(row);
  }

  async update(id: string, data: UpdateTenantInput): Promise<TenantConfig> {
    const row = await this.delegate.update({
      where: { id },
      data: {
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.host !== undefined && { host: data.host }),
        ...(data.port !== undefined && { port: data.port }),
        ...(data.dbName !== undefined && { dbName: data.dbName }),
        ...(data.user !== undefined && { user: data.user }),
        ...(data.password !== undefined && { password: data.password }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.meta !== undefined && { meta: data.meta }),
      },
    });
    return toConfig(row);
  }

  async delete(id: string): Promise<void> {
    await this.delegate.delete({ where: { id } });
  }
}
