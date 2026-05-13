import { Controller, Get } from '@nestjs/common';
import { InjectRegistry } from '@kosan/nestjs';
import { TenantRegistry, getHealthPayload } from '@kosan/core';

@Controller('health')
export class HealthController {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}

  @Get()
  check() {
    return { status: 'ok', ...getHealthPayload(this.registry) };
  }
}
