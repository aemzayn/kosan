import { ConnectionCache, TenantEvictedError } from "./ConnectionCache.js";
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
    return this.retryIfEvicted(async () => {
      const cached = this.lookups.getBySlug(slug);
      if (cached !== undefined) return this.buildContext(cached);

      const version = this.lookups.version;
      const tenant = await this.master.findBySlug(slug);
      if (tenant === null) throw new TenantNotFoundError(`slug=${slug}`);
      // Only fresh reads are cached: re-setting on hits would extend the TTL
      // forever under steady traffic and hide changes made by other processes.
      this.lookups.set(tenant, version);
      return this.buildContext(tenant);
    });
  }

  async resolveById(id: string): Promise<TenantContextValue<TConn>> {
    return this.retryIfEvicted(async () => {
      const cached = this.lookups.getById(id);
      if (cached !== undefined) return this.buildContext(cached);

      const version = this.lookups.version;
      const tenant = await this.master.findById(id);
      if (tenant === null) throw new TenantNotFoundError(`id=${id}`);
      this.lookups.set(tenant, version);
      return this.buildContext(tenant);
    });
  }

  /**
   * A connect can be cancelled while we wait on it, because the tenant was
   * updated, suspended or deleted at that moment. Resolve once more so the
   * caller sees the tenant's new state (403/404 or the new connection)
   * instead of an internal error.
   */
  private async retryIfEvicted<T>(resolve: () => Promise<T>): Promise<T> {
    try {
      return await resolve();
    } catch (err) {
      if (!(err instanceof TenantEvictedError)) throw err;
      return resolve();
    }
  }

  private async buildContext(tenant: TenantConfig): Promise<TenantContextValue<TConn>> {
    if (tenant.status !== "active") {
      throw new TenantNotActiveError(tenant.slug, tenant.status);
    }
    // Decryption only runs when a new connection is opened, not on cache hits.
    const connection = await this.cache.getOrConnect(tenant, (t) => this.decryptCredentials(t));
    const models = this.adapter.getModels(connection);
    return { tenant: withoutPassword(tenant), connection, models };
  }

  // ---------------------------------------------------------------------------
  // Tenant lifecycle
  // ---------------------------------------------------------------------------

  async createTenant(input: CreateTenantInput): Promise<TenantConfig> {
    const encrypted = await this.encryptCredentials(input);
    const onProvision = this.hooks?.onProvision;
    const onCreate = this.hooks?.onCreate;

    if (onProvision === undefined && onCreate === undefined) {
      return this.master.create(encrypted);
    }

    // Hidden from resolution until provisioning succeeds. If the process dies
    // mid-way, the row stays `provisioning`, distinguishable from a suspension.
    const tenant = await this.master.create({ ...encrypted, status: "provisioning" });
    try {
      const decrypted = await this.decryptCredentials(tenant);
      if (onProvision !== undefined) await onProvision(decrypted);
      if (onCreate !== undefined) {
        // Throw-away connection — don't pollute the cache.
        const conn = await this.adapter.connect(decrypted);
        try {
          await onCreate(decrypted, conn);
        } finally {
          await this.adapter.disconnect(conn);
        }
      }
    } catch (err) {
      // Roll back. If the rollback itself fails, the original error still wins
      // and the row is left with status `provisioning` for cleanup.
      await this.master.delete(tenant.id).catch(() => {});
      this.lookups.invalidate(tenant.id);
      throw err;
    }

    const ready = await this.master.update(tenant.id, { status: input.status ?? "active" });
    // A lookup during provisioning may have cached the interim `provisioning` row.
    this.lookups.invalidate(tenant.id);
    return ready;
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
    const onSuspend = this.hooks?.onSuspend;
    if (onSuspend !== undefined) await onSuspend(await this.decryptCredentials(updated));
    return updated;
  }

  async deleteTenant(id: string): Promise<void> {
    const tenant = await this.master.findById(id);
    // Delete the row first: anything resolving after this point gets a 404
    // instead of re-caching and reconnecting to a tenant about to be dropped.
    await this.master.delete(id);
    this.lookups.invalidate(id);
    await this.cache.evict(id);
    const onDelete = this.hooks?.onDelete;
    if (tenant !== null && onDelete !== undefined) {
      await onDelete(await this.decryptCredentials(tenant));
    }
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
