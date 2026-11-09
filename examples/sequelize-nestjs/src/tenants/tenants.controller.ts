import type { TenantRegistry } from "@kosan/core";
import type { CreateTenantInput } from "@kosan/core";
import { InjectRegistry } from "@kosan/nestjs";
import { Body, Controller, Get, Post } from "@nestjs/common";

@Controller("tenants")
export class TenantsController {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}

  @Get()
  list() {
    return this.registry.listTenants({ status: "active" });
  }

  @Post()
  provision(@Body() body: CreateTenantInput) {
    return this.registry.createTenant(body);
  }
}
