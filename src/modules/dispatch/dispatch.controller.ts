import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OkDto } from '../auth/auth.dto.js';
import { Perm, RequireModule } from '../auth/decorators.js';
import { CreateDispatchDto, DispatchablePageDto, DispatchDto, DispatchPageDto, DispatchQuery, ReturnablePageDto, ReturnableQuery, SampleDisposeDto, SampleReturnDto } from './dispatch.dto.js';
import { DispatchService } from './dispatch.service.js';

@ApiTags('dispatch')
@RequireModule('dispatch')
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  @Perm('dispatch.view')
  @ApiOkResponse({ type: DispatchPageDto })
  list(@Query() q: DispatchQuery) {
    return this.dispatch.list(q);
  }

  @Get('pending')
  @Perm('dispatch.view')
  @ApiOkResponse({ type: DispatchablePageDto })
  pending(@Query() q: DispatchQuery) {
    return this.dispatch.pending(q);
  }

  @Get('returnables')
  @Perm('dispatch.view')
  @ApiOkResponse({ type: ReturnablePageDto })
  returnables(@Query() q: ReturnableQuery) {
    return this.dispatch.returnables(q);
  }

  @Post('samples/:id/return')
  @HttpCode(200)
  @Perm('dispatch.edit')
  @ApiOkResponse({ type: OkDto })
  returned(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SampleReturnDto) {
    return this.dispatch.markReturned(id, dto);
  }

  @Post('samples/:id/dispose')
  @HttpCode(200)
  @Perm('dispatch.edit')
  @ApiOkResponse({ type: OkDto })
  disposed(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SampleDisposeDto) {
    return this.dispatch.markDisposed(id, dto);
  }

  @Get(':id')
  @Perm('dispatch.view')
  @ApiOkResponse({ type: DispatchDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.dispatch.get(id);
  }

  @Post()
  @Perm('dispatch.edit')
  @ApiOkResponse({ type: DispatchDto })
  create(@Body() dto: CreateDispatchDto) {
    return this.dispatch.create(dto);
  }
}
