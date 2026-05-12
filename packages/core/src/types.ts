export type TenantStatus = 'active' | 'suspended' | 'deleted';

export interface TenantConfig {
  id: string;
  slug: string;
  host: string;
  port: number;
  dbName: string;
  user: string;
  /** Stored value — may be encrypted depending on Cipher configuration. */
  password: string;
  status: TenantStatus;
  meta?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateTenantInput {
  slug: string;
  host: string;
  port: number;
  dbName: string;
  user: string;
  password: string;
  status?: TenantStatus;
  meta?: Record<string, unknown>;
}

export interface UpdateTenantInput {
  slug?: string;
  host?: string;
  port?: number;
  dbName?: string;
  user?: string;
  password?: string;
  status?: TenantStatus;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MasterStore — abstraction over where tenant records live (implemented by
// adapters; in tests replaced with an in-memory fake)
// ---------------------------------------------------------------------------

export interface MasterStore {
  findAll(filter?: { status?: TenantStatus }): Promise<TenantConfig[]>;
  findBySlug(slug: string): Promise<TenantConfig | null>;
  findById(id: string): Promise<TenantConfig | null>;
  create(data: CreateTenantInput): Promise<TenantConfig>;
  update(id: string, data: UpdateTenantInput): Promise<TenantConfig>;
  delete(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Adapter — ORM-specific connection and model management
// ---------------------------------------------------------------------------

/** A factory function registered once; called per-connection with the raw
 *  connection object to produce a model class / query builder. */
export type ModelFactory<TConn = unknown> = (conn: TConn) => unknown;

export interface Adapter<TConn = unknown> {
  connect(tenant: TenantConfig): Promise<TConn>;
  disconnect(conn: TConn): Promise<void>;
  getModels(conn: TConn): Record<string, unknown>;
  registerModelFactories?(factories: ModelFactory<TConn>[]): void;
}

// ---------------------------------------------------------------------------
// Cipher — optional at-rest encryption for credentials
// ---------------------------------------------------------------------------

export interface Cipher {
  encrypt(plain: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

export interface LifecycleHooks<TConn = unknown> {
  /** Called after a tenant row is created; use to provision the physical DB. */
  onCreate?(tenant: TenantConfig, conn: TConn): Promise<void>;
  /** Called after the tenant row is deleted and the cache entry evicted. */
  onDelete?(tenant: TenantConfig): Promise<void>;
  /** Called after the tenant is suspended and its cache entry evicted. */
  onSuspend?(tenant: TenantConfig): Promise<void>;
}

// ---------------------------------------------------------------------------
// Cache options
// ---------------------------------------------------------------------------

export interface CacheOptions {
  /** Maximum number of simultaneous tenant connections kept open. Default: 100 */
  maxSize?: number;
  /** Milliseconds of inactivity before a connection is closed. Default: 30 min */
  idleTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// TenantRegistry options
// ---------------------------------------------------------------------------

export interface TenantRegistryOptions<TConn = unknown> {
  master: MasterStore;
  adapter: Adapter<TConn>;
  cache?: CacheOptions;
  cipher?: Cipher;
  hooks?: LifecycleHooks<TConn>;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/** Extracts the tenant identifier (slug or id) from an incoming request.
 *  Can be async. Return null to signal "no tenant found". */
export interface Resolver {
  resolve(req: unknown): string | null | Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Context value stored in AsyncLocalStorage
// ---------------------------------------------------------------------------

export interface TenantContextValue<TConn = unknown> {
  tenant: TenantConfig;
  connection: TConn;
  models: Record<string, unknown>;
}
