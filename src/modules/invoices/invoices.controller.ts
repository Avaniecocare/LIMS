import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OkDto } from '../auth/auth.dto.js';
import { Perm, RequireModule } from '../auth/decorators.js';
import { AuditHistoryDto } from '../jobs/jobs.dto.js';
import { EmailLogDto } from '../quotations/quotations.dto.js';
import {
  ApplyAdvanceDto,
  CancelInvoiceDto,
  CreateCreditNoteDto,
  CreateInvoiceDto,
  CreatePaymentDto,
  DueQuery,
  DueSummaryDto,
  EmailInvoiceDto,
  InvoiceDto,
  InvoicePageDto,
  InvoiceQuery,
  IssueInvoiceDto,
  PaymentDto,
  PaymentPageDto,
  PaymentQuery,
  ReadyPageDto,
  RemindDto,
  ReversePaymentDto,
  UpdateDraftInvoiceDto,
} from './invoices.dto.js';
import { InvoicesService } from './invoices.service.js';

@ApiTags('invoices')
@RequireModule('billing')
@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('invoices')
  @Perm('invoices.view')
  @ApiOkResponse({ type: InvoicePageDto })
  list(@Query() q: InvoiceQuery) {
    return this.invoices.list(q);
  }

  @Get('invoices/ready')
  @Perm('invoices.view')
  @ApiOkResponse({ type: ReadyPageDto })
  ready(@Query() q: InvoiceQuery) {
    return this.invoices.readyQueue(q);
  }

  @Get('invoices/due')
  @Perm('invoices.view')
  @ApiOkResponse({ type: InvoicePageDto })
  due(@Query() q: DueQuery) {
    return this.invoices.due(q);
  }

  @Get('invoices/due/summary')
  @Perm('invoices.view')
  @ApiOkResponse({ type: DueSummaryDto })
  dueSummary(@Query('customerId') customerId?: string) {
    return this.invoices.dueSummary({ customerId });
  }

  @Get('invoices/:id')
  @Perm('invoices.view')
  @ApiOkResponse({ type: InvoiceDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(id);
  }

  @Post('invoices')
  @Perm('invoices.edit')
  @ApiOkResponse({ type: InvoiceDto })
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoices.create(dto);
  }

  @Patch('invoices/:id')
  @Perm('invoices.edit')
  @ApiOkResponse({ type: InvoiceDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDraftInvoiceDto) {
    return this.invoices.updateDraft(id, dto);
  }

  @Post('invoices/:id/issue')
  @HttpCode(200)
  @Perm('invoices.edit')
  @ApiOkResponse({ type: InvoiceDto })
  issue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueInvoiceDto) {
    return this.invoices.issue(id, dto);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @Perm('invoices.edit')
  @ApiOkResponse({ type: InvoiceDto })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInvoiceDto) {
    return this.invoices.cancel(id, dto.version, dto.reason, dto.irnCancelReason);
  }

  @Post('invoices/:id/email')
  @HttpCode(200)
  @Perm('invoices.edit')
  @ApiOkResponse({ type: OkDto })
  email(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EmailInvoiceDto) {
    return this.invoices.email(id, dto.to, dto.cc ?? null);
  }

  @Get('invoices/:id/emails')
  @Perm('invoices.view')
  @ApiOkResponse({ type: [EmailLogDto] })
  emails(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.emails(id);
  }

  @Get('invoices/:id/history')
  @Perm('invoices.view')
  @ApiOkResponse({ type: [AuditHistoryDto] })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.history(id);
  }

  @Post('invoices/:id/credit-notes')
  @HttpCode(200)
  @Perm('payments.edit')
  @ApiOkResponse({ type: InvoiceDto })
  creditNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCreditNoteDto) {
    return this.invoices.createCreditNote(id, dto);
  }

  /** Registers the invoice at the GST portal (IRN), or tries again after a failure. */
  @Post('invoices/:id/einvoice')
  @HttpCode(200)
  @Perm('invoices.edit')
  @ApiOkResponse({ type: InvoiceDto })
  registerIrn(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.registerIrn(id);
  }

  /** Registers a credit note at the GST portal, or tries again after a failure. Answers with its invoice. */
  @Post('credit-notes/:id/einvoice')
  @HttpCode(200)
  @Perm('invoices.edit', 'payments.edit')
  @ApiOkResponse({ type: InvoiceDto })
  registerCreditNoteIrn(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.registerCreditNoteIrn(id);
  }

  @Post('invoices/:id/remind')
  @HttpCode(200)
  @Perm('reminders.send')
  @ApiOkResponse({ type: InvoiceDto })
  remind(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RemindDto) {
    return this.invoices.remind(id, dto.to);
  }

  @Get('payments')
  @Perm('invoices.view')
  @ApiOkResponse({ type: PaymentPageDto })
  payments(@Query() q: PaymentQuery) {
    return this.invoices.listPayments(q);
  }

  @Get('payments/:id')
  @Perm('invoices.view')
  @ApiOkResponse({ type: PaymentDto })
  payment(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.getPayment(id);
  }

  @Post('payments')
  @Perm('payments.edit')
  @ApiOkResponse({ type: PaymentDto })
  createPayment(@Body() dto: CreatePaymentDto) {
    return this.invoices.createPayment(dto);
  }

  @Post('payments/:id/apply')
  @HttpCode(200)
  @Perm('payments.edit')
  @ApiOkResponse({ type: PaymentDto })
  apply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyAdvanceDto) {
    return this.invoices.applyAdvance(id, dto);
  }

  @Post('payments/:id/reverse')
  @HttpCode(200)
  @Perm('payments.edit')
  @ApiOkResponse({ type: PaymentDto })
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReversePaymentDto) {
    return this.invoices.reversePayment(id, dto.reason);
  }
}
