import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Perm } from '../auth/decorators.js';
import { ConvertedDto, ConvertibleQuotationDto, EmailLogDto, QuotationDto, QuotationPageDto, QuotationQuery, ReasonDto, SaveQuotationDto, SendQuotationDto, StatusEventDto, UpdateQuotationDto, VersionedActionDto } from './quotations.dto.js';
import { QuotationsService } from './quotations.service.js';

@ApiTags('quotations')
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get() @Perm('quotations.view') @ApiOkResponse({ type: QuotationPageDto })
  list(@Query() q: QuotationQuery) {
    return this.quotations.list(q);
  }

  @Get('convertible') @Perm('quotations.convert') @ApiOkResponse({ type: [ConvertibleQuotationDto] })
  convertible() {
    return this.quotations.convertible();
  }

  @Get(':id') @Perm('quotations.view') @ApiOkResponse({ type: QuotationDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.get(id);
  }

  @Post() @Perm('quotations.edit') @ApiOkResponse({ type: QuotationDto })
  create(@Body() dto: SaveQuotationDto) {
    return this.quotations.create(dto);
  }

  @Patch(':id') @Perm('quotations.edit') @ApiOkResponse({ type: QuotationDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuotationDto) {
    return this.quotations.update(id, dto);
  }

  @Post(':id/revise') @HttpCode(200) @Perm('quotations.edit') @ApiOkResponse({ type: QuotationDto })
  revise(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.quotations.revise(id, dto.version, dto.reason);
  }

  @Post(':id/send') @HttpCode(200) @Perm('quotations.send') @ApiOkResponse({ type: QuotationDto })
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendQuotationDto) {
    return this.quotations.send(id, dto);
  }

  @Post(':id/accept') @HttpCode(200) @Perm('quotations.decide') @ApiOkResponse({ type: QuotationDto })
  accept(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionedActionDto) {
    return this.quotations.accept(id, dto.version);
  }

  @Post(':id/reject') @HttpCode(200) @Perm('quotations.decide') @ApiOkResponse({ type: QuotationDto })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.quotations.reject(id, dto.version, dto.reason);
  }

  @Post(':id/convert') @HttpCode(200) @Perm('quotations.convert') @ApiOkResponse({ type: ConvertedDto })
  convert(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.convert(id);
  }

  @Get(':id/emails') @Perm('quotations.view') @ApiOkResponse({ type: [EmailLogDto] })
  emails(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.emails(id);
  }

  @Get(':id/history') @Perm('quotations.view') @ApiOkResponse({ type: [StatusEventDto] })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.history(id);
  }
}
