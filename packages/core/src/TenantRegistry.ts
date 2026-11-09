import { ConnectionCache } from "./ConnectionCache.js";
import type { CacheStats } from "./ConnectionCache.js";
import { TenantLookupCache } from "./TenantLookupCache.js";
import type {
  Adapter,
  Cipher,
  CreateTenantInput,
  LifecycleHooks,
  MasterStore,
  ModelFactory,
  TenantConfig,
  TenantContextValue,
  TenantInfo,
  TenantRegistryOptions,
  TenantStatus,
  UpdateTenantInput,
} from "./types.js";

export class TenantRegistry<TConn = unknown> {
  private readonly master: MasterStore;
  private readonly adapter: Adapter<TConn>;
  readonly cache: ConnectionCache<TConn>;
  private readonly lookups: TenantLookupCache;
  private readonly cipher: Cipher | undefined;
  private readonly hooks: LifecycleHooks<TConn> | undefined;

  private constructor(options: TenantRegistryOptions<TConn>) {
    this.master = options.master;
    this.adapter = options.adapter;
    this.cipher = options.cipher;
    this.hooks = options.hooks;
    this.cache = new ConnectionCache(this.adapter, options.cache);
    this.lookups = new TenantLookupCache(options.cache?.tenantTtlMs ?? 30_000);
  }

  static async create<TConn>(
    options: TenantRegistryOptions<TConn>,
  ): Promise<TenantRegistry<TConn>> {
    return new TenantRegistry(options);
  }

  // ---------------------------------------------------------------------------
  // Resolution — used by middleware
  // ---------------------------------------------------------------------------

  /** Resolves a tenant by slug, opens (or returns cached) connection, and
   *  returns a fully-populated context value ready for `runWithTenant`. */
  async resolveBySlug(slug: string): Promise<TenantContextValue<TConn>> {
    const tenant = this.lookups.getBySlug(slug) ?? (await this.master.findBySlug(slug));
    if (tenant === null) throw new TenantNotFoundError(`slug=${slug}`);
    this.lookups.set(tenant);
    return this.buildContext(tenant);
  }

  async resolveById(id: string): Promise<TenantContextValue<TConn>> {
    const tenant = this.lookups.getById(id) ?? (await this.master.findById(id));
    if (tenant === null) throw new TenantNotFoundError(`id=${id}`);
    this.lookups.set(tenant);
    return this.buildContext(tenant);
  }

  private async buildContext(tenant: TenantConfig): Promise<TenantContextValue<TConn>> {
    if (tenant.status !== "active") {
      throw new TenantNotActiveError(tenant.slug, tenant.status);
    }
    const decrypted = await this.decryptCredentials(tenant);
    const connection = await this.cache.getOrConnect(decrypted);
    const models = this.adapter.getModels(connection);
    return { tenant: withoutPassword(tenant), connection, models };
  }

  // ---------------------------------------------------------------------------
  // Tenant lifecycle
  // ---------------------------------------------------------------------------

  async createTenant(input: CreateTenantInput): Promise<TenantConfig> {
    const encrypted = await this.encryptCredentials(input);
    const tenant = await this.master.create(encrypted);

    if (this.hooks?.onCreate !== undefined) {
      // Use a throw-away connection for provisioning — don't pollute the cache.
      const decrypted = await this.decryptCredentials(tenant);
      const conn = await this.adapter.connect(decrypted);
      try {
        await this.hooks.onCreate(decrypted, conn);
      } finally {
        await this.adapter.disconnect(conn);
      }
    }

    return tenant;
  }

  async updateTenant(id: string, data: UpdateTenantInput): Promise<TenantConfig> {
    const payload =
      data.password !== undefined && this.cipher !== undefined
        ? { ...data, password: await this.cipher.encrypt(data.password) }
        : data;
    const updated = await this.master.update(id, payload);
    // Evict so the next request picks up the new config and credentials.
    this.lookups.invalidate(id);
    await this.cache.evict(id);
    return updated;
  }

  async suspendTenant(id: string): Promise<TenantConfig> {
    const updated = await this.master.update(id, { status: "suspended" });
    this.lookups.invalidate(id);
    await this.cache.evict(id);
    await this.hooks?.onSuspend?.(updated);
    return updated;
  }

  async deleteTenant(id: string): Promise<void> {
    const tenant = await this.master.findById(id);
    this.lookups.invalidate(id);
    await this.cache.evict(id);
    await this.master.delete(id);
    if (tenant !== null) await this.hooks?.onDelete?.(tenant);
  }

  async listTenants(filter?: { status?: TenantStatus }): Promise<TenantConfig[]> {
    return this.master.findAll(filter);
  }

  async getTenant(id: string): Promise<TenantConfig | null> {
    return this.master.findById(id);
  }

  // ---------------------------------------------------------------------------
  // Model registration — delegates to the adapter
  // ---------------------------------------------------------------------------

  registerModels(factories: ModelFactory<TConn>[]): void {
    if (this.adapter.registerModelFactories === undefined) {
      throw new Error(
        "The current adapter does not support registerModelFactories. " +
          "Consult the adapter documentation for how to register models.",
      );
    }
    this.adapter.registerModelFactories(factories);
  }

  // ---------------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------------

  getStats(): { cacheSize: number; cacheMaxSize: number; entries: CacheStats[] } {
    return {
      cacheSize: this.cache.size,
      cacheMaxSize: this.cache.maxSize,
      entries: this.cache.stats(),
    };
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    await this.cache.disconnectAll();
  }

  // ---------------------------------------------------------------------------
  // Credential helpers
  // ---------------------------------------------------------------------------

  private async encryptCredentials(input: CreateTenantInput): Promise<CreateTenantInput> {
    if (this.cipher === undefined) return input;
    return { ...input, password: await this.cipher.encrypt(input.password) };
  }

  private async decryptCredentials(tenant: TenantConfig): Promise<TenantConfig> {
    if (this.cipher === undefined) return tenant;
    return { ...tenant, password: await this.cipher.decrypt(tenant.password) };
  }
}

/** Strips credentials before the tenant is exposed to application code. */
function withoutPassword(tenant: TenantConfig): TenantInfo {
  const { password: _password, ...info } = tenant;
  return info;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TenantNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Tenant not found: ${identifier}`);
    this.name = "TenantNotFoundError";
  }
}

export class TenantNotActiveError extends Error {
  readonly status: TenantStatus;
  constructor(slug: string, status: TenantStatus) {
    super(`Tenant "${slug}" is not active (status: ${status})`);
    this.name = "TenantNotActiveError";
    this.status = status;
  }
}
