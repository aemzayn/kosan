import { type TenantRegistry, getHealthPayload } from "@kosan/core";
import { InjectRegistry } from "@kosan/nestjs";
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  constructor(@InjectRegistry() private readonly registry: TenantRegistry) {}

  @Get()
  check() {
    return { status: "ok", ...getHealthPayload(this.registry) };
  }
}
