import { Injectable, OnModuleInit } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { actorId, can } from '../../common/context.js';
import { badRequest, conflict, forbidden, notFound, rule } from '../../common/errors.js';
import { amountInWords, formatDate, istToday } from '../../common/india.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { assertSystemTransition, assertTransition, INVOICE } from '../../common/workflow.js';
import type { CompanySnapshot } from '../../config/company.config.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { MailService } from '../../core/mail.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, ReadPrismaService, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { computeTax } from '../billing/tax.js';
import { DocumentsService, requirePermission, XLSX_MIME } from '../documents/documents.service.js';
import { MastersService } from '../masters/masters.service.js';
import { buildWorkbook } from '../masters/excel.js';
import { PdfService } from '../pdf/pdf.service.js';
import { esc, type CustomerSnapshot } from '../pdf/templates/base.js';
import { creditNoteHtml, invoiceHtml, statementHtml } from '../pdf/templates/commercial.js';
import { customerSnapshot } from '../quotations/quotations.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { AGEING_BUCKETS, ageingBucket, bucketDueDateRange, daysOverdue, type AgeingBucket } from './ageing.js';
import type { ApplyAdvanceDto, CreateCreditNoteDto, CreateInvoiceDto, CreatePaymentDto, DueQuery, InvoiceQuery, IssueInvoiceDto, PaymentQuery, UpdateDraftInvoiceDto } from './invoices.dto.js';

const summaryInclude = { customer: { select: { name: true, crn: true } } } as const;
const fullInclude = {
  ...summaryInclude,
  lines: { orderBy: { seq: 'asc' } },
  allocations: { orderBy: { createdAt: 'asc' }, include: { payment: { select: { paymentNo: true, paidOn: true, mode: true, reference: true } } } },
  creditNotes: { orderBy: { createdAt: 'asc' } },
  reminders: { orderBy: { at: 'desc' } },
} as const;
type SummaryRow = Prisma.InvoiceGetPayload<{ include: typeof summaryInclude }>;
type FullRow = Prisma.InvoiceGetPayload<{ include: typeof fullInclude }>;

const str = (v: unknown) => String(v);
const dec = (v: Decimal.Value) => new Decimal(v);
export const balanceOf = (i: { grandTotal: unknown; paidAmount: unknown; creditedAmount: unknown }) => dec(str(i.grandTotal)).minus(str(i.paidAmount)).minus(str(i.creditedAmount));
const OPEN: ('ISSUED' | 'PARTIALLY_PAID')[] = ['ISSUED', 'PARTIALLY_PAID'];

/** One definition for "this test can still be billed", shared by the queue and invoice creation. */
const billable = (): Prisma.SampleTestWhereInput => ({ deletedAt: null, status: 'APPROVED', invoiceLines: { none: { invoice: { status: { not: 'CANCELLED' } } } } });

@Injectable()
export class InvoicesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: ReadPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly company: CompanyService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly mail: MailService,
    private readonly masters: MastersService,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit() {
    this.documents.register('invoice-pdf', {
      authorize: requirePermission('invoices.view'),
      run: async (p) => {
        const inv = await this.prisma.invoice.findUniqueOrThrow({ where: { id: String(p.invoiceId) }, include: fullInclude });
        const company = (inv.companySnapshot as unknown as CompanySnapshot | null) ?? this.company.snapshot();
        const customer = (inv.customerSnapshot as unknown as CustomerSnapshot | null) ?? (await customerSnapshot(this.prisma as never, inv.customerId));
        const terms = inv.termsSnapshot ?? (await this.prisma.termsVersion.findFirst({ where: { kind: 'INVOICE' }, orderBy: { versionNo: 'desc' } }))?.body ?? null;
        const html = invoiceHtml({ ...inv, draft: inv.status === 'DRAFT', terms, company, customer });
        return { buffer: await this.pdf.render(html, { company }), filename: `Tax Invoice ${inv.invoiceNo ?? 'Draft'}.pdf`.replace(/[/\\]/g, '-'), mimeType: 'application/pdf', entity: 'Invoice', entityId: inv.id };
      },
    });
    this.documents.register('credit-note-pdf', {
      authorize: requirePermission('invoices.view'),
      run: async (p) => {
        const cn = await this.prisma.creditNote.findUniqueOrThrow({ where: { id: String(p.creditNoteId) }, include: { invoice: true } });
        const company = cn.companySnapshot as unknown as CompanySnapshot;
        const html = creditNoteHtml({ ...cn, invoiceNo: cn.invoice.invoiceNo, invoiceDate: cn.invoice.invoiceDate, company, customer: cn.customerSnapshot as unknown as CustomerSnapshot });
        return { buffer: await this.pdf.render(html, { company }), filename: `Credit Note ${cn.creditNoteNo}.pdf`.replace(/[/\\]/g, '-'), mimeType: 'application/pdf', entity: 'CreditNote', entityId: cn.id };
      },
    });
    this.documents.register('statement-of-account', { authorize: requirePermission('invoices.view'), run: (p) => this.renderStatement(String(p.customerId), p.from as string | undefined, p.to as string | undefined) });
    this.documents.register('due-invoices-export', {
      authorize: requirePermission('invoices.view'),
      run: async (p) => {
        const today = istToday();
        const rows = await this.read.invoice.findMany({ where: this.dueWhere(p as DueQuery, today), include: summaryInclude, orderBy: { dueDate: 'asc' } });
        const buffer = await buildWorkbook([
          {
            name: 'Due invoices',
            columns: [
              { header: 'Customer', key: 'customerName', width: 32 }, { header: 'CRN', key: 'crn' }, { header: 'Invoice no.', key: 'invoiceNo', width: 22 }, { header: 'Invoice date', key: 'invoiceDate' }, { header: 'Due date', key: 'dueDate' }, { header: 'Amount', key: 'grandTotal' }, { header: 'Paid', key: 'paidAmount' }, { header: 'Credited', key: 'creditedAmount' }, { header: 'Balance', key: 'balance' }, { header: 'Days overdue', key: 'daysOverdue' }, { header: 'Ageing', key: 'ageingBucket' },
            ],
            rows: rows.map((r) => this.summary(r, today)).map((r) => ({ ...r, invoiceDate: r.invoiceDate ? formatDate(r.invoiceDate) : '', dueDate: r.dueDate ? formatDate(r.dueDate) : '', grandTotal: Number(r.grandTotal), paidAmount: Number(r.paidAmount), creditedAmount: Number(r.creditedAmount), balance: Number(r.balance) })),
          },
        ]);
        return { buffer, filename: 'due-invoices.xlsx', mimeType: XLSX_MIME };
      },
    });
    this.scheduler.register({ name: 'invoice-reminders', pattern: '30 9 * * *', run: () => this.sendScheduledReminders() });
  }

  // ---------------------------------------------------------------- shapes
  private summary(i: SummaryRow, today = istToday()) {
    const balance = balanceOf(i);
    const open = OPEN.includes(i.status as 'ISSUED');
    const days = i.dueDate ? daysOverdue(i.dueDate, today) : 0;
    return {
      id: i.id, invoiceNo: i.invoiceNo, customerId: i.customerId, customerName: i.customer.name, crn: i.customer.crn, status: i.status, invoiceDate: i.invoiceDate, dueDate: i.dueDate, grandTotal: str(i.grandTotal), paidAmount: str(i.paidAmount), creditedAmount: str(i.creditedAmount), balance: balance.toFixed(2),
      overdue: open && days > 0 && balance.greaterThan(0), daysOverdue: open && days > 0 ? days : 0, ageingBucket: open && i.dueDate ? ageingBucket(i.dueDate, today) : null, isInterState: i.isInterState, version: i.version,
    };
  }

  private full(i: FullRow) {
    return {
      ...this.summary(i),
      placeOfSupply: i.placeOfSupply, placeOfSupplyCode: i.placeOfSupplyCode, subtotal: str(i.subtotal), discountAmount: str(i.discountAmount), taxableAmount: str(i.taxableAmount), gstRate: str(i.gstRate), cgst: str(i.cgst), sgst: str(i.sgst), igst: str(i.igst), roundOff: str(i.roundOff), amountInWords: i.amountInWords, cancelReason: i.cancelReason, notes: i.notes, issuedAt: i.issuedAt,
      lines: i.lines.map((l) => ({ id: l.id, seq: l.seq, jobId: l.jobId, sampleTestId: l.sampleTestId, description: l.description, sacCode: l.sacCode, quantity: l.quantity, rate: str(l.rate), rateSource: l.rateSource, amount: str(l.amount) })),
      allocations: i.allocations.map((a) => ({ id: a.id, paymentId: a.paymentId, paymentNo: a.payment.paymentNo, paidOn: a.payment.paidOn, mode: a.payment.mode, reference: a.payment.reference, amount: str(a.amount) })),
      creditNotes: i.creditNotes.map((c) => ({ id: c.id, creditNoteNo: c.creditNoteNo, issuedOn: c.issuedOn, reason: c.reason, taxableAmount: str(c.taxableAmount), cgst: str(c.cgst), sgst: str(c.sgst), igst: str(c.igst), roundOff: str(c.roundOff), total: str(c.total), amountInWords: c.amountInWords })),
      reminders: i.reminders.map((r) => ({ id: r.id, kind: r.kind, at: r.at, emailLogId: r.emailLogId })),
    };
  }

  private async load(id: string, tx: Tx | PrismaService = this.prisma) {
    const i = await tx.invoice.findFirst({ where: { id, deletedAt: null }, include: fullInclude });
    if (!i) throw notFound('Invoice');
    return i;
  }

  async get(id: string) {
    return this.full(await this.load(id));
  }

  async list(q: InvoiceQuery) {
    const where: Prisma.InvoiceWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.from || q.to ? { invoiceDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ invoiceNo: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({ where, include: summaryInclude, orderBy: orderBy(q, ['invoiceNo', 'invoiceDate', 'dueDate', 'grandTotal', 'status', 'createdAt'], 'createdAt'), ...skipTake(q) }),
      this.prisma.invoice.count({ where }),
    ]);
    const today = istToday();
    return toPage(rows.map((r) => this.summary(r, today)), total, q);
  }

  // ---------------------------------------------------------------- ready to invoice
  /** Jobs with an approved report and at least one approved test not yet billed. */
  async readyQueue(q: InvoiceQuery) {
    const where: Prisma.JobWhereInput = {
      deletedAt: null,
      status: { not: 'CANCELLED' },
      ...(q.customerId ? { customerId: q.customerId } : {}),
      samples: { some: { status: { not: 'CANCELLED' }, tests: { some: billable() }, reports: { some: { revisions: { some: { status: { in: ['APPROVED', 'ISSUED'] } } } } } } },
      ...(q.q ? { OR: [{ jobNo: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({ where, include: { customer: { select: { name: true, crn: true } }, samples: { where: { status: { not: 'CANCELLED' } }, include: { tests: { where: billable(), select: { rate: true } }, reports: { select: { reportNo: true } } } } }, orderBy: { receivedAt: 'asc' }, ...skipTake(q) }),
      this.prisma.job.count({ where }),
    ]);
    return toPage(
      rows.map((j) => {
        const tests = j.samples.flatMap((s) => s.tests);
        const amount = tests.reduce((sum, t) => sum.plus(t.rate === null ? 0 : str(t.rate)), new Decimal(0));
        return { jobId: j.id, jobNo: j.jobNo, customerId: j.customerId, customerName: j.customer.name, crn: j.customer.crn, reportNos: j.samples.flatMap((s) => s.reports.map((r) => r.reportNo)), testCount: tests.length, amount: amount.toFixed(2), missingRates: tests.filter((t) => t.rate === null).length, receivedAt: j.receivedAt };
      }),
      total,
      q,
    );
  }

  /** Recomputes totals on a draft; issued invoices never reach this. */
  private async recompute(tx: Tx, invoiceId: string, discountPct?: string | null) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true, customer: true } });
    const pct = discountPct ?? (Number(inv.subtotal) ? dec(str(inv.discountAmount)).div(str(inv.subtotal)).times(100).toString() : '0');
    if (Number(pct) < 0 || Number(pct) > 100) throw badRequest('Discount must be between 0 and 100', [{ field: 'discountPct', message: 'Between 0 and 100' }]);
    const gstRate = await this.settings.get('tax.gstRate', tx);
    const t = computeTax({ amounts: inv.lines.map((l) => str(l.amount)), discountPct: pct, gstRate, customerStateCode: inv.placeOfSupplyCode, labStateCode: this.company.config.gstStateCode });
    await tx.invoice.update({ where: { id: invoiceId }, data: { subtotal: t.subtotal, discountAmount: t.discountAmount, taxableAmount: t.taxableAmount, gstRate: t.gstRate, isInterState: t.isInterState, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff, grandTotal: t.grandTotal, amountInWords: t.amountInWords } });
  }

  async create(dto: CreateInvoiceDto) {
    const id = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: dto.customerId, deletedAt: null } });
      if (!customer) throw badRequest('Customer not found', [{ field: 'customerId', message: 'Not found' }]);
      const jobs = await tx.job.findMany({
        where: { id: { in: dto.jobIds }, deletedAt: null },
        include: { samples: { where: { status: { not: 'CANCELLED' } }, include: { tests: { where: billable(), orderBy: { createdAt: 'asc' } } } } },
      });
      if (jobs.length !== dto.jobIds.length) throw notFound('Job');
      if (jobs.some((j) => j.customerId !== dto.customerId)) throw badRequest('All jobs on an invoice must belong to one customer', [{ field: 'jobIds', message: 'Different customer' }]);
      const lines: Prisma.InvoiceLineCreateManyInvoiceInput[] = [];
      let seq = 1;
      for (const job of jobs) {
        for (const sample of job.samples) {
          for (const t of sample.tests) {
            // Rate priority: quotation, then customer, then standard. Booking froze the first available.
            const fallback = t.rate === null ? await this.masters.lookupRate(t.testId, dto.customerId, istToday(), tx) : null;
            const rate = t.rate !== null ? str(t.rate) : fallback?.rate;
            if (rate === null || rate === undefined) throw rule('RATE_MISSING', `No rate is set for ${t.testName} on ${sample.sampleNo}. Add one in Masters first.`);
            lines.push({ seq: seq++, jobId: job.id, sampleTestId: t.id, description: `${sample.sampleNo} · ${t.testName}${t.methodName ? ` (${t.methodName})` : ''}`, sacCode: this.company.config.sacCode, quantity: 1, rate, rateSource: t.rate !== null ? t.rateSource : fallback?.source, amount: rate });
          }
        }
      }
      if (!lines.length) throw rule('NOTHING_TO_BILL', 'These jobs have no approved tests left to bill');
      const inv = await tx.invoice.create({
        data: { customerId: dto.customerId, placeOfSupply: customer.stateName, placeOfSupplyCode: customer.stateCode, notes: dto.notes, createdById: actorId(), isDemo: customer.isDemo, lines: { createMany: { data: lines } } },
      });
      await this.recompute(tx, inv.id, dto.discountPct ?? '0');
      await this.audit.status(tx, { entity: 'Invoice', entityId: inv.id, from: null, to: 'DRAFT' });
      return inv.id;
    });
    return this.get(id);
  }

  async updateDraft(id: string, dto: UpdateDraftInvoiceDto) {
    await this.prisma.$transaction(async (tx) => {
      const inv = await this.load(id, tx);
      if (inv.status !== 'DRAFT') throw rule('LOCKED', 'Issued invoices cannot be edited. Cancel it or raise a credit note.');
      const { count } = await tx.invoice.updateMany({ where: { id, version: dto.version }, data: { notes: dto.notes, version: { increment: 1 } } });
      if (count !== 1) throw conflict();
      for (const r of dto.lineRates ?? []) {
        if (Number(r.rate) < 0) throw badRequest('A rate cannot be negative', [{ field: 'lineRates', message: 'Negative rate' }]);
        const line = inv.lines.find((l) => l.id === r.lineId);
        if (!line) throw badRequest('That line is not on this invoice', [{ field: 'lineRates', message: 'Unknown line' }]);
        await tx.invoiceLine.update({ where: { id: line.id }, data: { rate: r.rate, amount: dec(r.rate).times(line.quantity).toFixed(2), rateSource: 'OVERRIDE' } });
        await this.audit.record({ action: 'Invoice.rateOverride', entity: 'Invoice', entityId: id, before: { lineId: line.id, rate: str(line.rate) }, after: { rate: r.rate }, reason: r.reason }, tx);
      }
      await this.recompute(tx, id, dto.discountPct);
    });
    return this.get(id);
  }

  /** Numbers, dates and freezes the invoice. From here it is immutable. */
  async issue(id: string, dto: IssueInvoiceDto) {
    await this.prisma.$transaction(async (tx) => {
      const inv = await this.load(id, tx);
      assertTransition(INVOICE, inv.status, 'ISSUED');
      await this.recompute(tx, id);
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: inv.customerId } });
      const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : istToday();
      const dueDate = new Date(invoiceDate.getTime() + customer.creditDays * 86_400_000);
      const invoiceNo = await this.numbering.next(tx, 'INVOICE', invoiceDate);
      const terms = await tx.termsVersion.findFirst({ where: { kind: 'INVOICE' }, orderBy: { versionNo: 'desc' } });
      const { count } = await tx.invoice.updateMany({
        where: { id, version: dto.version },
        data: {
          status: 'ISSUED', invoiceNo, invoiceDate, dueDate, issuedAt: new Date(), issuedById: actorId(), version: { increment: 1 },
          companySnapshot: this.company.snapshot() as unknown as Prisma.InputJsonValue,
          customerSnapshot: (await customerSnapshot(tx, inv.customerId)) as unknown as Prisma.InputJsonValue,
          termsSnapshot: terms?.body ?? null,
        },
      });
      if (count !== 1) throw conflict();
      await this.audit.status(tx, { entity: 'Invoice', entityId: id, from: 'DRAFT', to: 'ISSUED', meta: { invoiceNo } });
    });
    if (dto.emailTo) await this.email(id, dto.emailTo, dto.emailCc ?? null);
    return this.get(id);
  }

  async email(id: string, to: string, cc: string | null) {
    const inv = await this.load(id);
    if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') throw rule('NOT_ISSUED', 'Only an issued invoice can be emailed');
    const company = inv.companySnapshot as unknown as CompanySnapshot;
    const job = await this.prisma.documentJob.create({
      data: {
        kind: 'invoice-pdf',
        params: {
          invoiceId: id,
          email: {
            to, cc, subject: `Tax invoice ${inv.invoiceNo} — ${company.companyName}`, template: 'invoice', entity: 'Invoice', entityId: id,
            bodyHtml: `<p>Dear Sir/Madam,</p><p>Please find attached tax invoice <strong>${esc(inv.invoiceNo)}</strong>, due on ${formatDate(inv.dueDate)}.</p>`,
          },
        },
        createdById: actorId(),
      },
    });
    await this.documents.queueExisting(job.id);
    await this.audit.record({ action: 'Invoice.emailQueued', entity: 'Invoice', entityId: id, after: { to } });
    return { ok: true };
  }

  emails(id: string) {
    return this.prisma.emailLog.findMany({ where: { entity: 'Invoice', entityId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, toAddress: true, ccAddress: true, subject: true, template: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true } });
  }

  async cancel(id: string, version: number, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const inv = await this.load(id, tx);
      assertTransition(INVOICE, inv.status, 'CANCELLED', reason);
      if (Number(inv.paidAmount) > 0 || Number(inv.creditedAmount) > 0) throw rule('HAS_PAYMENTS', 'This invoice has payments or credit notes. Reverse them first.');
      const { count } = await tx.invoice.updateMany({ where: { id, version }, data: { status: 'CANCELLED', cancelReason: reason, version: { increment: 1 } } });
      if (count !== 1) throw conflict();
      await this.audit.status(tx, { entity: 'Invoice', entityId: id, from: inv.status, to: 'CANCELLED', reason });
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- status from money
  /** The only place an invoice's paid state changes. Locks the row, then derives status from the balance. */
  private async applyMoney(tx: Tx, invoiceId: string, change: { paid?: Decimal; credited?: Decimal }) {
    await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const paid = dec(str(inv.paidAmount)).plus(change.paid ?? 0);
    const credited = dec(str(inv.creditedAmount)).plus(change.credited ?? 0);
    const balance = dec(str(inv.grandTotal)).minus(paid).minus(credited);
    if (balance.isNegative()) throw rule('OVERPAYMENT', `That is more than the balance on ${inv.invoiceNo}`);
    const status = balance.isZero() ? 'PAID' : paid.plus(credited).isZero() ? 'ISSUED' : 'PARTIALLY_PAID';
    if (status !== inv.status) {
      assertSystemTransition(INVOICE, inv.status, status);
      await this.audit.status(tx, { entity: 'Invoice', entityId: invoiceId, from: inv.status, to: status });
    }
    await tx.invoice.update({ where: { id: invoiceId }, data: { paidAmount: paid.toFixed(2), creditedAmount: credited.toFixed(2), status, version: { increment: 1 } } });
  }

  // ---------------------------------------------------------------- credit notes
  async createCreditNote(invoiceId: string, dto: CreateCreditNoteDto) {
    await this.prisma.$transaction(async (tx) => {
      const inv = await this.load(invoiceId, tx);
      if (!['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status)) throw rule('NOT_ISSUED', 'A credit note needs an issued invoice');
      const taxable = dec(dto.taxableAmount);
      if (taxable.lessThanOrEqualTo(0)) throw badRequest('Enter an amount above zero', [{ field: 'taxableAmount', message: 'Must be above zero' }]);
      const t = computeTax({ amounts: [taxable.toFixed(2)], gstRate: str(inv.gstRate), customerStateCode: inv.placeOfSupplyCode, labStateCode: this.company.config.gstStateCode });
      const total = dec(t.grandTotal);
      if (total.greaterThan(balanceOf(inv))) throw rule('OVERCREDIT', `The credit of ${t.grandTotal} is more than the balance of ${balanceOf(inv).toFixed(2)}`);
      const issuedOn = dto.issuedOn ? new Date(dto.issuedOn) : istToday();
      const creditNoteNo = await this.numbering.next(tx, 'CREDIT_NOTE', issuedOn);
      const cn = await tx.creditNote.create({
        data: {
          creditNoteNo, invoiceId, issuedOn, reason: dto.reason, taxableAmount: t.taxableAmount, gstRate: t.gstRate, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff, total: t.grandTotal, amountInWords: amountInWords(t.grandTotal),
          customerSnapshot: inv.customerSnapshot ?? {}, companySnapshot: this.company.snapshot() as unknown as Prisma.InputJsonValue, createdById: actorId(), isDemo: inv.isDemo,
        },
      });
      await this.applyMoney(tx, invoiceId, { credited: total });
      await this.audit.record({ action: 'CreditNote.create', entity: 'Invoice', entityId: invoiceId, after: { creditNoteNo, total: t.grandTotal, id: cn.id }, reason: dto.reason }, tx);
    });
    return this.get(invoiceId);
  }

  // ---------------------------------------------------------------- payments
  private paymentDto(p: Prisma.PaymentGetPayload<{ include: { customer: { select: { name: true } }; allocations: { include: { invoice: { select: { invoiceNo: true } } } } } }>) {
    return {
      id: p.id, paymentNo: p.paymentNo, customerId: p.customerId, customerName: p.customer.name, paidOn: p.paidOn, mode: p.mode, reference: p.reference, amount: str(p.amount), unapplied: str(p.unapplied), isAdvance: p.isAdvance, notes: p.notes, reversed: !!p.deletedAt,
      allocations: p.allocations.map((a) => ({ invoiceId: a.invoiceId, invoiceNo: a.invoice.invoiceNo, amount: str(a.amount) })),
    };
  }

  private paymentInclude = { customer: { select: { name: true } }, allocations: { include: { invoice: { select: { invoiceNo: true } } } } } as const;

  private async allocate(tx: Tx, paymentId: string, customerId: string, allocations: { invoiceId: string; amount: string }[]) {
    let total = new Decimal(0);
    for (const a of allocations) {
      const amount = dec(a.amount);
      if (amount.lessThanOrEqualTo(0)) throw badRequest('Allocate an amount above zero', [{ field: 'allocations', message: 'Must be above zero' }]);
      const inv = await tx.invoice.findFirst({ where: { id: a.invoiceId, deletedAt: null } });
      if (!inv) throw notFound('Invoice');
      if (inv.customerId !== customerId) throw badRequest('That invoice belongs to another customer', [{ field: 'allocations', message: 'Different customer' }]);
      if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status)) throw rule('NOT_PAYABLE', `${inv.invoiceNo ?? 'This invoice'} cannot take a payment`);
      await tx.paymentAllocation.create({ data: { paymentId, invoiceId: a.invoiceId, amount: amount.toFixed(2) } });
      await this.applyMoney(tx, a.invoiceId, { paid: amount });
      total = total.plus(amount);
    }
    return total;
  }

  async createPayment(dto: CreatePaymentDto) {
    const id = await this.prisma.$transaction(async (tx) => {
      const amount = dec(dto.amount);
      if (amount.lessThanOrEqualTo(0)) throw badRequest('Enter an amount above zero', [{ field: 'amount', message: 'Must be above zero' }]);
      const customer = await tx.customer.findFirst({ where: { id: dto.customerId, deletedAt: null } });
      if (!customer) throw badRequest('Customer not found', [{ field: 'customerId', message: 'Not found' }]);
      const allocated = (dto.allocations ?? []).reduce((s, a) => s.plus(a.amount), new Decimal(0));
      if (allocated.greaterThan(amount)) throw badRequest('You have allocated more than the payment', [{ field: 'allocations', message: 'More than the payment' }]);
      const paymentNo = await this.numbering.next(tx, 'PAYMENT', new Date(dto.paidOn));
      const payment = await tx.payment.create({
        data: { paymentNo, customerId: dto.customerId, paidOn: new Date(dto.paidOn), mode: dto.mode, reference: dto.reference, amount: amount.toFixed(2), unapplied: amount.minus(allocated).toFixed(2), isAdvance: amount.greaterThan(allocated), notes: dto.notes, createdById: actorId(), isDemo: customer.isDemo },
      });
      await this.allocate(tx, payment.id, dto.customerId, dto.allocations ?? []);
      await this.audit.record({ action: 'Payment.create', entity: 'Payment', entityId: payment.id, after: { paymentNo, amount: amount.toFixed(2), allocations: dto.allocations ?? [] } }, tx);
      return payment.id;
    });
    return this.getPayment(id);
  }

  async getPayment(id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id }, include: this.paymentInclude });
    if (!p) throw notFound('Payment');
    return this.paymentDto(p);
  }

  /** Puts an advance held on account against invoices. */
  async applyAdvance(paymentId: string, dto: ApplyAdvanceDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
      const p = await tx.payment.findFirst({ where: { id: paymentId, deletedAt: null } });
      if (!p) throw notFound('Payment');
      const asked = dto.allocations.reduce((s, a) => s.plus(a.amount), new Decimal(0));
      if (asked.greaterThan(str(p.unapplied))) throw rule('OVER_APPLIED', `Only ${str(p.unapplied)} is left on this payment`);
      await this.allocate(tx, paymentId, p.customerId, dto.allocations);
      await tx.payment.update({ where: { id: paymentId }, data: { unapplied: dec(str(p.unapplied)).minus(asked).toFixed(2), version: { increment: 1 } } });
      await this.audit.record({ action: 'Payment.applied', entity: 'Payment', entityId: paymentId, after: dto.allocations }, tx);
    });
    return this.getPayment(paymentId);
  }

  /** Mistakes get reversed, not deleted: the record stays, and invoices return to their earlier balance. */
  async reversePayment(paymentId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.findFirst({ where: { id: paymentId, deletedAt: null }, include: { allocations: true } });
      if (!p) throw notFound('Payment');
      const net = new Map<string, Decimal>();
      for (const a of p.allocations) net.set(a.invoiceId, (net.get(a.invoiceId) ?? new Decimal(0)).plus(str(a.amount)));
      for (const [invoiceId, amount] of net) {
        if (!amount.isZero()) {
          await tx.paymentAllocation.create({ data: { paymentId, invoiceId, amount: amount.negated().toFixed(2) } });
          await this.applyMoney(tx, invoiceId, { paid: amount.negated() });
        }
      }
      await tx.payment.update({ where: { id: paymentId }, data: { deletedAt: new Date(), unapplied: 0, version: { increment: 1 } } });
      await this.audit.record({ action: 'Payment.reversed', entity: 'Payment', entityId: paymentId, before: { amount: str(p.amount) }, reason }, tx);
    });
    return this.getPayment(paymentId);
  }

  async listPayments(q: PaymentQuery) {
    const where: Prisma.PaymentWhereInput = {
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.unapplied ? { unapplied: { gt: 0 }, deletedAt: null } : {}),
      ...(q.from || q.to ? { paidOn: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ paymentNo: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({ where, include: this.paymentInclude, orderBy: orderBy(q, ['paidOn', 'amount', 'paymentNo'], 'paidOn'), ...skipTake(q) }),
      this.prisma.payment.count({ where }),
    ]);
    return toPage(rows.map((r) => this.paymentDto(r)), total, q);
  }

  // ---------------------------------------------------------------- due invoices
  private dueWhere(q: DueQuery, today: Date): Prisma.InvoiceWhereInput {
    return {
      deletedAt: null,
      status: { in: OPEN },
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.bucket ? { dueDate: bucketDueDateRange(q.bucket as AgeingBucket, today) } : {}),
      ...(q.overdue === 'true' ? { dueDate: { lt: today } } : q.overdue === 'false' ? { dueDate: { gte: today } } : {}),
      ...(q.q ? { OR: [{ invoiceNo: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
  }

  async due(q: DueQuery) {
    const today = istToday();
    const where = this.dueWhere(q, today);
    const [rows, total] = await Promise.all([
      this.read.invoice.findMany({ where, include: summaryInclude, orderBy: orderBy(q, ['dueDate', 'invoiceDate', 'grandTotal', 'invoiceNo'], 'dueDate', 'asc'), ...skipTake(q) }),
      this.read.invoice.count({ where }),
    ]);
    return toPage(rows.map((r) => this.summary(r, today)), total, q);
  }

  /** Ageing and customer totals: the one definition dashboards and reports share. */
  async dueSummary(q: Pick<DueQuery, 'customerId'> = {}, today = istToday()) {
    const rows = await this.read.invoice.findMany({
      where: { deletedAt: null, status: { in: OPEN }, ...(q.customerId ? { customerId: q.customerId } : {}) },
      select: { customerId: true, dueDate: true, grandTotal: true, paidAmount: true, creditedAmount: true, customer: { select: { name: true, crn: true } } },
    });
    const ageing = new Map(AGEING_BUCKETS.map((b) => [b, { amount: new Decimal(0), count: 0 }]));
    const customers = new Map<string, { customerId: string; customerName: string; crn: string; outstanding: Decimal; overdue: Decimal; invoiceCount: number }>();
    let total = new Decimal(0);
    for (const r of rows) {
      const balance = balanceOf(r);
      const bucket = ageingBucket(r.dueDate!, today);
      const a = ageing.get(bucket)!;
      a.amount = a.amount.plus(balance);
      a.count++;
      total = total.plus(balance);
      const c = customers.get(r.customerId) ?? { customerId: r.customerId, customerName: r.customer.name, crn: r.customer.crn, outstanding: new Decimal(0), overdue: new Decimal(0), invoiceCount: 0 };
      c.outstanding = c.outstanding.plus(balance);
      if (bucket !== 'Not Due') c.overdue = c.overdue.plus(balance);
      c.invoiceCount++;
      customers.set(r.customerId, c);
    }
    return {
      total: total.toFixed(2),
      ageing: AGEING_BUCKETS.map((b) => ({ bucket: b, amount: ageing.get(b)!.amount.toFixed(2), count: ageing.get(b)!.count })),
      customers: [...customers.values()].sort((x, y) => y.outstanding.comparedTo(x.outstanding)).map((c) => ({ ...c, outstanding: c.outstanding.toFixed(2), overdue: c.overdue.toFixed(2) })),
    };
  }

  private async renderStatement(customerId: string, from?: string, to?: string) {
    const customer = await this.prisma.customer.findFirstOrThrow({ where: { id: customerId } });
    const toDate = to ? new Date(to) : istToday();
    const fromDate = from ? new Date(from) : null;
    const invoices = await this.prisma.invoice.findMany({ where: { customerId, status: { notIn: ['DRAFT', 'CANCELLED'] }, invoiceDate: { lte: toDate } }, select: { id: true, invoiceNo: true, invoiceDate: true, grandTotal: true } });
    const payments = await this.prisma.payment.findMany({ where: { customerId, deletedAt: null, paidOn: { lte: toDate } }, select: { paymentNo: true, paidOn: true, amount: true, mode: true, reference: true } });
    const credits = await this.prisma.creditNote.findMany({ where: { invoice: { customerId }, issuedOn: { lte: toDate } }, select: { creditNoteNo: true, issuedOn: true, total: true } });
    const moves = [
      ...invoices.map((i) => ({ date: i.invoiceDate!, type: 'Invoice', reference: i.invoiceNo ?? '', debit: dec(str(i.grandTotal)), credit: null as Decimal | null })),
      ...payments.map((p) => ({ date: p.paidOn, type: `Payment (${p.mode})`, reference: [p.paymentNo, p.reference].filter(Boolean).join(' · '), debit: null as Decimal | null, credit: dec(str(p.amount)) })),
      ...credits.map((c) => ({ date: c.issuedOn, type: 'Credit note', reference: c.creditNoteNo, debit: null as Decimal | null, credit: dec(str(c.total)) })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
    let running = new Decimal(0);
    const entries: { date: Date; type: string; reference: string; debit: string | null; credit: string | null; balance: string }[] = [];
    for (const m of moves) {
      running = running.plus(m.debit ?? 0).minus(m.credit ?? 0);
      if (fromDate && m.date < fromDate) continue;
      entries.push({ date: m.date, type: m.type, reference: m.reference, debit: m.debit?.toFixed(2) ?? null, credit: m.credit?.toFixed(2) ?? null, balance: running.toFixed(2) });
    }
    const opening = fromDate ? moves.filter((m) => m.date < fromDate).reduce((s, m) => s.plus(m.debit ?? 0).minus(m.credit ?? 0), new Decimal(0)) : null;
    if (opening && !opening.isZero()) entries.unshift({ date: fromDate!, type: 'Opening balance', reference: '', debit: opening.isPositive() ? opening.toFixed(2) : null, credit: opening.isNegative() ? opening.abs().toFixed(2) : null, balance: opening.toFixed(2) });
    const summary = await this.dueSummary({ customerId });
    const company = this.company.snapshot();
    const html = statementHtml({ company, customerName: customer.name, crn: customer.crn, gstin: customer.gstin, from: fromDate, to: toDate, entries, closingBalance: running.toFixed(2), ageing: summary.ageing });
    return { buffer: await this.pdf.render(html, { company }), filename: `Statement ${customer.crn}.pdf`, mimeType: 'application/pdf', entity: 'Customer', entityId: customerId };
  }

  // ---------------------------------------------------------------- reminders
  private async reminderRecipient(invoice: { customerId: string }) {
    const c = await this.prisma.customerContact.findFirst({ where: { customerId: invoice.customerId, deletedAt: null, email: { not: null } }, orderBy: { isPrimary: 'desc' } });
    return c?.email ?? null;
  }

  private async sendReminder(invoiceId: string, kind: 'MANUAL' | 'AUTOMATIC', to: string, sentById: string | null) {
    const inv = await this.load(invoiceId);
    if (!OPEN.includes(inv.status as 'ISSUED')) throw rule('NOT_DUE', 'Only unpaid invoices can be reminded');
    const company = inv.companySnapshot as unknown as CompanySnapshot;
    const balance = balanceOf(inv).toFixed(2);
    const emailLogId = await this.mail.enqueue({
      to,
      subject: `Payment reminder: invoice ${inv.invoiceNo} — ${company.companyName}`,
      template: 'reminder',
      entity: 'Invoice',
      entityId: invoiceId,
      bodyHtml: `<p>Dear Sir/Madam,</p><p>Our records show a balance of <strong>₹${esc(balance)}</strong> on invoice <strong>${esc(inv.invoiceNo)}</strong>, due on ${formatDate(inv.dueDate)}.</p><p>Please arrange payment, or let us know if it has already been made.</p><p>Bank: ${esc(company.bank.bankName)}, A/c ${esc(company.bank.accountNumber)}, IFSC ${esc(company.bank.ifsc)}</p>`,
    });
    await this.prisma.reminderLog.create({ data: { invoiceId, kind, emailLogId, sentById } });
    await this.audit.record({ action: 'Invoice.reminder', entity: 'Invoice', entityId: invoiceId, after: { kind, to } });
  }

  async remind(invoiceId: string, to?: string | null) {
    if (!can('reminders.send')) throw forbidden();
    const inv = await this.load(invoiceId);
    const recipient = to ?? (await this.reminderRecipient(inv));
    if (!recipient) throw badRequest('This customer has no contact email. Enter an address.', [{ field: 'to', message: 'Required' }]);
    await this.sendReminder(invoiceId, 'MANUAL', recipient, actorId());
    return this.get(invoiceId);
  }

  /** Scheduled: sends on the configured days after the due date, at most once per invoice and day-number. */
  async sendScheduledReminders(today = istToday()): Promise<number> {
    if (!(await this.settings.get('reminders.enabled'))) return 0;
    const schedule = await this.settings.get('reminders.scheduleDays');
    const rows = await this.prisma.invoice.findMany({ where: { deletedAt: null, status: { in: OPEN }, dueDate: { lt: today } }, select: { id: true, dueDate: true, customerId: true, reminders: { where: { kind: 'AUTOMATIC' }, select: { at: true } } } });
    let sent = 0;
    for (const r of rows) {
      const days = daysOverdue(r.dueDate!, today);
      if (!schedule.includes(days)) continue;
      if (r.reminders.some((x) => istToday(x.at).getTime() === today.getTime())) continue;
      const to = await this.reminderRecipient(r);
      if (!to) continue;
      await this.sendReminder(r.id, 'AUTOMATIC', to, null);
      sent++;
    }
    return sent;
  }

  /** Cancelling work removes it from drafts. Issued invoices are untouched and need a credit note. */
  async removeFromDrafts(tx: Tx, sampleTestIds: string[]) {
    const lines = await tx.invoiceLine.findMany({ where: { sampleTestId: { in: sampleTestIds }, invoice: { status: 'DRAFT' } }, select: { id: true, invoiceId: true } });
    if (!lines.length) return;
    await tx.invoiceLine.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
    for (const invoiceId of new Set(lines.map((l) => l.invoiceId))) await this.recompute(tx, invoiceId);
  }

  async history(id: string) {
    const rows = await this.prisma.auditLog.findMany({ where: { entity: 'Invoice', entityId: id }, orderBy: { at: 'desc' }, take: 200 });
    return rows.map((r) => ({ id: r.id.toString(), at: r.at, userName: r.userName, action: r.action, before: r.before, after: r.after, reason: r.reason }));
  }
}
