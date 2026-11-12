import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { can } from '../../common/context.js';
import { forbidden } from '../../common/errors.js';
import { OkDto } from '../auth/auth.dto.js';
import { Perm } from '../auth/decorators.js';
import { AuditHistoryDto } from '../jobs/jobs.dto.js';
import { EmailLogDto } from '../quotations/quotations.dto.js';
import {
  ReportActionDto,
  ReportApproveDto,
  ReportCorrectDto,
  ReportDetailDto,
  ReportEmailDto,
  ReportIssueDto,
  ReportPageDto,
  ReportPreviewDto,
  ReportQuery,
  ReportRejectDto,
  ReportReviseDto,
  SignedPdfDto,
} from './reports.dto.js';
import { ReportsService } from './reports.service.js';

/** A report's document names the customer, so viewing reports alone is not enough to read it. */
const assertCustomerAccess = () => {
  if (!can('customers.view')) throw forbidden();
};

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Perm('reports.view')
  @ApiOkResponse({ type: ReportPageDto })
  list(@Query() q: ReportQuery) {
    return this.reports.list(q);
  }

  @Get('revisions/:revisionId/pdf')
  @Perm('reports.view')
  @ApiOkResponse({ type: SignedPdfDto })
  pdf(@Param('revisionId', ParseUUIDPipe) id: string) {
    assertCustomerAccess();
    return this.reports.pdfUrl(id);
  }

  @Get(':id')
  @Perm('reports.view')
  @ApiOkResponse({ type: ReportDetailDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(id);
  }

  @Get(':id/preview')
  @Perm('reports.view')
  @ApiQuery({ name: 'revisionNo', required: false, type: Number })
  @ApiOkResponse({ type: ReportPreviewDto })
  preview(@Param('id', ParseUUIDPipe) id: string, @Query('revisionNo', new ParseIntPipe({ optional: true })) revisionNo?: number) {
    assertCustomerAccess();
    return this.reports.preview(id, revisionNo);
  }

  @Get(':id/history')
  @Perm('reports.view')
  @ApiOkResponse({ type: [AuditHistoryDto] })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.history(id);
  }

  @Get(':id/emails')
  @Perm('reports.view')
  @ApiOkResponse({ type: [EmailLogDto] })
  emails(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.emails(id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Perm('reports.review')
  @ApiOkResponse({ type: ReportDetailDto })
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportActionDto) {
    return this.reports.submitForReview(id, dto.version);
  }

  @Post(':id/pass-review')
  @HttpCode(200)
  @Perm('reports.review')
  @ApiOkResponse({ type: ReportDetailDto })
  pass(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportActionDto) {
    return this.reports.passReview(id, dto.version);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Perm('reports.review', 'reports.approve')
  @ApiOkResponse({ type: ReportDetailDto })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportRejectDto) {
    return this.reports.reject(id, dto);
  }

  @Patch(':id/draft')
  @Perm('reports.review', 'reports.approve')
  @ApiOkResponse({ type: ReportDetailDto })
  correct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportCorrectDto) {
    return this.reports.correct(id, dto);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Perm('reports.approve')
  @ApiOkResponse({ type: ReportDetailDto })
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportApproveDto) {
    return this.reports.approve(id, dto.version, dto.password);
  }

  /** For an approved report whose final PDF failed to render. */
  @Post(':id/regenerate-pdf')
  @HttpCode(200)
  @Perm('reports.approve', 'reports.issue')
  @ApiOkResponse({ type: ReportDetailDto })
  regeneratePdf(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.regeneratePdf(id);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @Perm('reports.issue')
  @ApiOkResponse({ type: ReportDetailDto })
  issue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportIssueDto) {
    return this.reports.issue(id, dto);
  }

  @Post(':id/email')
  @HttpCode(200)
  @Perm('reports.issue')
  @ApiOkResponse({ type: OkDto })
  email(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportEmailDto) {
    return this.reports.emailReport(id, dto.to, dto.cc ?? null);
  }

  @Post(':id/revise')
  @HttpCode(200)
  @Perm('reports.revise')
  @ApiOkResponse({ type: ReportDetailDto })
  revise(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportReviseDto) {
    return this.reports.revise(id, dto.reason);
  }
}
