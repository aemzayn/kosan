import { Controller, Get, Post, Body } from '@nestjs/common';
import { InjectRegistry } from '@huni/nestjs';
import { TenantRegistry } from '@huni/core';
import type { CreateTenantInput } from '@huni/core';

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
