import type { Adapter, ModelFactory, TenantConfig } from "../../src/types.js";

export interface FakeConnection {
  tenantId: string;
  disconnected: boolean;
}

/**
 * In-memory adapter used in unit tests. Each `connect()` returns a plain
 * object; `disconnect()` marks it so tests can assert it was called.
 */
export class FakeAdapter implements Adapter<FakeConnection> {
  readonly connections: FakeConnection[] = [];
  private factories: ModelFactory<FakeConnection>[] = [];

  connectCallCount = 0;
  disconnectCallCount = 0;

  async connect(tenant: TenantConfig): Promise<FakeConnection> {
    this.connectCallCount++;
    const conn: FakeConnection = { tenantId: tenant.id, disconnected: false };
    this.connections.push(conn);
    return conn;
  }

  async disconnect(conn: FakeConnection): Promise<void> {
    this.disconnectCallCount++;
    conn.disconnected = true;
  }

  getModels(conn: FakeConnection): Record<string, unknown> {
    const models: Record<string, unknown> = {};
    for (const factory of this.factories) {
      const result = factory(conn);
      if (result !== null && typeof result === "object" && "name" in result) {
        models[(result as { name: string }).name] = result;
      }
    }
    return models;
  }

  registerModelFactories(factories: ModelFactory<FakeConnection>[]): void {
    this.factories = factories;
  }
}
