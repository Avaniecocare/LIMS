import { Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Perm, WhenReadOnly } from '../auth/decorators.js';
import { DataExportService } from './data-export.service.js';
import { DataExportDto, DownloadDto, EmailDto, EmailPageDto, EmailQuery, SystemStatusDto } from './operations.dto.js';
import { OutboxService } from './outbox.service.js';
import { StatusService } from './status.service.js';

@ApiTags('operations')
@Controller('admin')
export class OperationsController {
  constructor(
    private readonly statusService: StatusService,
    private readonly outbox: OutboxService,
    private readonly exports: DataExportService,
  ) {}

  @Get('status')
  @Perm('admin.settings')
  @ApiOkResponse({ type: SystemStatusDto })
  status() {
    return this.statusService.status();
  }

  @Get('emails')
  @Perm('admin.emails')
  @ApiOkResponse({ type: EmailPageDto })
  emails(@Query() q: EmailQuery) {
    return this.outbox.list(q);
  }

  @Post('emails/:id/resend')
  @HttpCode(200)
  @Perm('admin.emails')
  @ApiOkResponse({ type: EmailDto })
  resend(@Param('id', ParseUUIDPipe) id: string) {
    return this.outbox.resend(id);
  }

  @Get('data-exports')
  @Perm('admin.dataExport')
  @ApiOkResponse({ type: [DataExportDto] })
  listExports() {
    return this.exports.list();
  }

  @WhenReadOnly('a lab can always take its data with it')
  @Post('data-exports')
  @HttpCode(200)
  @Perm('admin.dataExport')
  @ApiOkResponse({ type: DataExportDto })
  requestExport() {
    return this.exports.request();
  }

  /** POST, because each download is recorded. */
  @WhenReadOnly('a lab can always take its data with it')
  @Post('data-exports/:id/parts/:part/download')
  @HttpCode(200)
  @Perm('admin.dataExport')
  @ApiOkResponse({ type: DownloadDto })
  download(@Param('id', ParseUUIDPipe) id: string, @Param('part', ParseIntPipe) part: number) {
    return this.exports.download(id, part);
  }
}
