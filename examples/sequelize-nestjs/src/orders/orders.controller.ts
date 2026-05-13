import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentTenant } from '@huni/nestjs';
import type { TenantContextValue } from '@huni/core';
import type { ModelStatic, Model } from 'sequelize';

@Controller('orders')
export class OrdersController {
  @Get()
  async list(@CurrentTenant() ctx: TenantContextValue) {
    const Order = ctx.models['Order'] as ModelStatic<Model>;
    return Order.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() ctx: TenantContextValue,
    @Body() body: { product: string; quantity: number; total: string },
  ) {
    const Order = ctx.models['Order'] as ModelStatic<Model>;
    return Order.create(body as Record<string, unknown>);
  }

  @Delete(':id')
  async remove(@CurrentTenant() ctx: TenantContextValue, @Param('id') id: string) {
    const Order = ctx.models['Order'] as ModelStatic<Model>;
    const deleted = await Order.destroy({ where: { id } });
    return { deleted };
  }
}
