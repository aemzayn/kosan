import type { TenantConfig, TenantStatus } from '@huni/core';

// ---------------------------------------------------------------------------
// Minimal structural interfaces — avoids a hard dependency on @prisma/client.
// These are satisfied by the generated PrismaClient automatically.
// ---------------------------------------------------------------------------

/** Minimal interface that any Prisma client satisfies. */
export interface PrismaClientLike {
  $disconnect(): Promise<void>;
  $connect(): Promise<void>;
}

/**
 * Constructor type for a generated PrismaClient.
 * The datasource name (default: `"db"`) must match the one declared in
 * your `schema.prisma` file.
 */
export type PrismaClientConstructor<TClient extends PrismaClientLike> = new (options: {
  datasources: { [datasourceName: string]: { url: string } };
}) => TClient;

// ---------------------------------------------------------------------------
// Tenant delegate — structural type satisfied by `prisma.tenant`
// ---------------------------------------------------------------------------

/**
 * The shape of `prisma.<modelName>` that `PrismaMasterStore` requires.
 *
 * Add this model to your Prisma schema:
 *
 * ```prisma
 * model Tenant {
 *   id        String       @id @default(uuid())
 *   slug      String       @unique
 *   host      String
 *   port      Int
 *   dbName    String       @map("db_name")
 *   user      String
 *   password  String
 *   status    TenantStatus @default(active)
 *   meta      Json?
 *   createdAt DateTime     @default(now()) @map("created_at")
 *   updatedAt DateTime     @updatedAt      @map("updated_at")
 *
 *   @@map("tenants")
 * }
 *
 * enum TenantStatus {
 *   active
 *   suspended
 *   deleted
 * }
 * ```
 */
export interface TenantDelegate {
  findMany(args?: {
    where?: Partial<TenantRow>;
  }): Promise<TenantRow[]>;

  findFirst(args: {
    where: Partial<TenantRow>;
  }): Promise<TenantRow | null>;

  findUnique(args: {
    where: { id: string } | { slug: string };
  }): Promise<TenantRow | null>;

  create(args: {
    data: Omit<TenantRow, 'createdAt' | 'updatedAt'>;
  }): Promise<TenantRow>;

  update(args: {
    where: { id: string };
    data: Partial<Omit<TenantRow, 'id' | 'createdAt' | 'updatedAt'>>;
  }): Promise<TenantRow>;

  delete(args: {
    where: { id: string };
  }): Promise<TenantRow>;
}

/** Shape of a row returned by Prisma from the `tenants` table. */
export interface TenantRow {
  id: string;
  slug: string;
  host: string;
  port: number;
  dbName: string;
  user: string;
  password: string;
  status: TenantStatus;
  meta: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface PrismaAdapterOptions<TClient extends PrismaClientLike> {
  /**
   * The generated `PrismaClient` class (not an instance).
   *
   * @example
   * import { PrismaClient } from '@prisma/client';
   * new PrismaAdapter({ PrismaClient, buildUrl: ... });
   */
  PrismaClient: PrismaClientConstructor<TClient>;

  /**
   * Builds the database connection URL from a tenant config.
   *
   * @example
   * buildUrl: (t) => `postgresql://${t.user}:${t.password}@${t.host}:${t.port}/${t.dbName}`
   */
  buildUrl: (tenant: TenantConfig) => string;

  /**
   * The datasource name declared in `schema.prisma`.
   * Default: `"db"`
   */
  datasourceName?: string;
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

/** The value stored in `models` by the Prisma adapter. */
export interface PrismaModels<TClient extends PrismaClientLike> {
  prisma: TClient;
}
