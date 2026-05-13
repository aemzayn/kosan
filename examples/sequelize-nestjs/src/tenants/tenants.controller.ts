import { Controller, Get, Post, Body } from '@nestjs/common';
import { InjectRegistry } from '@kosan/nestjs';
import { TenantRegistry } from '@kosan/core';
import type { CreateTenantInput } from '@kosan/core';

@Controller('tenants')
export class TenantsController {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}

  @Get()
  list() {
    return this.registry.listTenants({ status: 'active' });
  }

  @Post()
  provision(@Body() body: CreateTenantInput) {
    return this.registry.createTenant(body);
  }
}
