import { Module, MiddlewareConsumer } from '@nestjs/common';
import { HuniModule, TenantMiddleware } from '@huni/nestjs';
import { SubdomainResolver } from '@huni/core';
import { SequelizeMasterStore, SequelizeAdapter } from '@huni/sequelize';
import { Sequelize } from 'sequelize';
import { OrdersModule } from './orders/orders.module';
import { HealthModule } from './health/health.module';
import { TenantsModule } from './tenants/tenants.module';
import { AppService } from './app.service';

@Module({
  imports: [
    /**
     * HuniModule.forRootAsync performs async initialisation (waiting on
     * SequelizeMasterStore.create) inside NestJS's DI lifecycle.
     */
    HuniModule.forRootAsync({
      useFactory: async () => {
        const master = new Sequelize({
          dialect: 'postgres',
          host: 'localhost',
          port: 5432,
          database: 'master',
          username: 'admin',
          password: 'admin',
          logging: false,
        });

        const masterStore = await SequelizeMasterStore.create(master);

        const adapter = new SequelizeAdapter({
          defaultDialect: 'postgres',
          pool: { max: 5, idle: 30_000 },
          logging: false,
        });

        return {
          resolver: new SubdomainResolver(),
          master: masterStore,
          adapter,
          missingTenantStatus: 400,
          onMissingTenant: (slug: string) => {
            console.warn(`[huni] unknown tenant slug: "${slug}"`);
          },
          hooks: {
            async onCreate(tenant, conn) {
              await conn.sync({ force: false });
              console.log(`[huni] provisioned schema for tenant: ${tenant.slug}`);
            },
          },
        };
      },
    }),
    OrdersModule,
    HealthModule,
    TenantsModule,
  ],
  // AppService registers model factories once the registry is ready.
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply tenant resolution to all routes except /tenants and /health —
    // those are admin routes that don't need a per-tenant context.
    consumer
      .apply(TenantMiddleware)
      .exclude('/tenants(.*)', '/health(.*)')
      .forRoutes('*');
  }
}
