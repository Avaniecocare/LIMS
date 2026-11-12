import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Perm } from '../auth/decorators.js';
import { HistoryEntryDto } from '../masters/masters.dto.js';
import { CreateCustomerDto, CustomerDto, CustomerPageDto, CustomerQuery, CustomerSummaryDto, CustomerTestPageDto, CustomerTestsQuery, UpdateCustomerDto } from './customers.dto.js';
import { CustomersService } from './customers.service.js';

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Perm('customers.view')
  @ApiOkResponse({ type: CustomerPageDto })
  list(@Query() q: CustomerQuery) {
    return this.customers.list(q);
  }

  @Get(':id')
  @Perm('customers.view')
  @ApiOkResponse({ type: CustomerDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Post()
  @Perm('customers.edit')
  @ApiOkResponse({ type: CustomerDto })
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Patch(':id')
  @Perm('customers.edit')
  @ApiOkResponse({ type: CustomerDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(id, dto);
  }

  @Get(':id/summary')
  @Perm('customers.view')
  @ApiOkResponse({ type: CustomerSummaryDto })
  summary(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.summary(id);
  }

  @Get(':id/tests')
  @Perm('customers.view')
  @ApiOkResponse({ type: CustomerTestPageDto })
  tests(@Param('id', ParseUUIDPipe) id: string, @Query() q: CustomerTestsQuery) {
    return this.customers.tests(id, q);
  }

  @Get(':id/history')
  @Perm('customers.view')
  @ApiOkResponse({ type: [HistoryEntryDto] })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.history(id);
  }
}
