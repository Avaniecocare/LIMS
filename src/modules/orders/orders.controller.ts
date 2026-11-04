import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Perm } from '../auth/decorators.js';
import { CreateOrderDto, OrderDto, OrderPageDto, OrderQuery, OwnerDto, PipelineStageDto, UpdateOrderDto } from './orders.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get() @Perm('orders.view') @ApiOkResponse({ type: OrderPageDto })
  list(@Query() q: OrderQuery) {
    return this.orders.list(q);
  }

  @Get('pipeline') @Perm('orders.view') @ApiOkResponse({ type: [PipelineStageDto] })
  pipeline() {
    return this.orders.pipeline();
  }

  @Get('owners') @Perm('orders.view') @ApiOkResponse({ type: [OwnerDto] })
  owners() {
    return this.orders.owners();
  }

  @Get(':id') @Perm('orders.view') @ApiOkResponse({ type: OrderDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Post() @Perm('orders.edit') @ApiOkResponse({ type: OrderDto })
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Patch(':id') @Perm('orders.edit') @ApiOkResponse({ type: OrderDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.update(id, dto);
  }
}
