import type { TenantRegistry } from "@kosan/core";
import { InjectRegistry } from "@kosan/nestjs";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { OrderModel } from "./models/order";

/**
 * Registers model factories on the Kosan registry once the NestJS DI
 * container has fully initialised. This is the NestJS equivalent of
 * calling `registry.registerModels([...])` right after `TenantRegistry.create`.
 */
@Injectable()
export class AppService implements OnModuleInit {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}

  onModuleInit() {
    this.registry.registerModels([OrderModel]);
    console.log("[kosan] model factories registered");
  }
}
