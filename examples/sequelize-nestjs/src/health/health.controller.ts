import { Controller, Get } from '@nestjs/common';
import { InjectRegistry } from '@huni/nestjs';
import { TenantRegistry, getHealthPayload } from '@huni/core';

@Controller('health')
export class HealthController {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}

  @Get()
  check() {
    return { status: 'ok', ...getHealthPayload(this.registry) };
  }
}
