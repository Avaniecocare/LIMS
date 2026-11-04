import { Injectable, OnModuleInit } from '@nestjs/common';
import { can, currentUser, actorId } from '../../common/context.js';
import { badRequest, conflict, forbidden, notFound, rule } from '../../common/errors.js';
import { formatDate, istToday } from '../../common/india.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { assertSystemTransition, assertTransition, QUOTATION } from '../../common/workflow.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { type CompanySnapshot } from '../../config/company.config.js';
import { computeTax, lineAmount } from '../billing/tax.js';
import { DocumentsService, requirePermission } from '../documents/documents.service.js';
import { MastersService } from '../masters/masters.service.js';
import { esc, type CustomerSnapshot } from '../pdf/templates/base.js';
import { quotationHtml } from '../pdf/templates/quotation.js';
import { PdfService } from '../pdf/pdf.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import type { QuotationLineInput, QuotationQuery, SaveQuotationDto, SendQuotationDto, UpdateQuotationDto } from './quotations.dto.js';

const summaryInclude = { customer: { select: { name: true, crn: true } }, jobs: { select: { id: true }, take: 1 } } as const;
const fullInclude = { ...summaryInclude, versions: { orderBy: { versionNo: 'desc' }, include: { lines: { orderBy: { seq: 'asc' } } } } } as const;
type Summary = Prisma.QuotationGetPayload<{ include: typeof summaryInclude }>;
type Full = Prisma.QuotationGetPayload<{ include: typeof fullInclude }>;

const str = (d: unknown) => String(d);

const summary = (q: Summary) => ({
  id: q.id, quotationNo: q.quotationNo, customerId: q.customerId, customerName: q.customer.name, crn: q.customer.crn, orderId: q.orderId, status: q.status, currentVersionNo: q.currentVersionNo,
  validUntil: q.validUntil, grandTotal: str(q.grandTotal), rejectReason: q.rejectReason, sentAt: q.sentAt, acceptedAt: q.acceptedAt, createdAt: q.createdAt, version: q.version, jobId: q.jobs[0]?.id ?? null,
});

const full = (q: Full) => ({
  ...summary(q),
  versions: q.versions.map((v) => ({
    id: v.id, versionNo: v.versionNo, documentTitle: v.documentTitle, validUntil: v.validUntil, estimatedDays: v.estimatedDays, paymentTerms: v.paymentTerms, deliveryAddress: v.deliveryAddress, contactPerson: v.contactPerson, revisionNote: v.revisionNote,
    discountPct: str(v.discountPct), subtotal: str(v.subtotal), discountAmount: str(v.discountAmount), taxableAmount: str(v.taxableAmount), gstRate: str(v.gstRate), cgst: str(v.cgst), sgst: str(v.sgst), igst: str(v.igst), roundOff: str(v.roundOff), grandTotal: str(v.grandTotal),
    amountInWords: v.amountInWords, createdAt: v.createdAt,
    lines: v.lines.map((l) => ({ id: l.id, seq: l.seq, sampleDescription: l.sampleDescription, requiredQuantity: l.requiredQuantity, testId: l.testId, testCode: l.testCode, testName: l.testName, methodName: l.methodName, quantity: l.quantity, rate: str(l.rate), rateSource: l.rateSource, overrideReason: l.overrideReason, discountPct: str(l.discountPct), amount: str(l.amount) })),
  })),
});

export async function customerSnapshot(tx: Tx, customerId: string): Promise<CustomerSnapshot> {
  const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, include: { contacts: { where: { deletedAt: null } }, addresses: { where: { deletedAt: null } } } });
  const fmt = (a?: (typeof c.addresses)[number]) => (a ? [a.line1, a.line2, `${a.city}${a.pincode ? ` ${a.pincode}` : ''}`, a.stateName].filter(Boolean).join('\n') : null);
  const contact = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];
  return {
    crn: c.crn, name: c.name, gstin: c.gstin, pan: c.pan, stateName: c.stateName, stateCode: c.stateCode,
    billingAddress: fmt(c.addresses.find((a) => a.kind === 'BILLING') ?? c.addresses[0]),
    reportAddress: fmt(c.addresses.find((a) => a.kind === 'REPORT') ?? c.addresses.find((a) => a.kind === 'BILLING') ?? c.addresses[0]),
    contactName: contact?.name ?? null, contactEmail: contact?.email ?? null, contactPhone: contact?.phone ?? null,
  };
}

export const QUOTATION_PDF = 'quotation-pdf';

@Injectable()
export class QuotationsService implements OnModuleInit {
  /** Set by the Jobs module, which owns job creation. */
  converter: ((tx: Tx, quotationId: string) => Promise<{ jobId: string; jobNo: string }>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly company: CompanyService,
    private readonly masters: MastersService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit() {
    this.documents.register(QUOTATION_PDF, {
      authorize: requirePermission('quotations.view'),
      run: async (p) => {
        const html = await this.renderHtml(String(p.versionId));
        const v = await this.prisma.quotationVersion.findUniqueOrThrow({ where: { id: String(p.versionId) }, include: { quotation: true } });
        const company = (v.companySnapshot as unknown as CompanySnapshot) ?? this.company.snapshot();
        return {
          buffer: await this.pdf.render(html, { company }),
          filename: `${v.documentTitle} ${v.quotation.quotationNo} v${v.versionNo}.pdf`.replace(/[/\\]/g, '-'),
          mimeType: 'application/pdf',
          entity: 'Quotation',
          entityId: v.quotationId,
        };
      },
    });
    this.scheduler.register({ name: 'quotations-expire', pattern: '5 0 * * *', run: () => this.expireOverdue() });
  }

  /** PDFs regenerate from the snapshot taken at sending, so they never change afterwards. */
  private async renderHtml(versionId: string) {
    const v = await this.prisma.quotationVersion.findUniqueOrThrow({ where: { id: versionId }, include: { quotation: true, lines: { orderBy: { seq: 'asc' } } } });
    const company = (v.companySnapshot as unknown as CompanySnapshot | null) ?? this.company.snapshot();
    const customer = (v.customerSnapshot as unknown as CustomerSnapshot | null) ?? (await customerSnapshot(this.prisma as never, v.quotation.customerId));
    const terms = v.termsSnapshot ?? (await this.prisma.termsVersion.findFirst({ where: { kind: 'QUOTATION' }, orderBy: { versionNo: 'desc' } }))?.body ?? null;
    return quotationHtml({ ...v, quotationNo: v.quotation.quotationNo, date: v.quotation.sentAt ?? v.createdAt, terms, company, customer });
  }

  /** Accepted and not yet converted. Deliberately carries no prices. */
  async convertible() {
    const rows = await this.prisma.quotation.findMany({
      where: { deletedAt: null, status: 'ACCEPTED', jobs: { none: {} } },
      include: { customer: { select: { name: true } }, versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { lines: { select: { sampleDescription: true } } } } },
      orderBy: { acceptedAt: 'asc' },
      take: 200,
    });
    return rows.map((q) => ({ id: q.id, quotationNo: q.quotationNo, customerId: q.customerId, customerName: q.customer.name, acceptedAt: q.acceptedAt, samples: [...new Set(q.versions[0].lines.map((l) => l.sampleDescription))], testCount: q.versions[0].lines.length }));
  }

  async list(q: QuotationQuery) {
    const where: Prisma.QuotationWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999+05:30`) } : {}) } } : {}),
      ...(q.q ? { OR: [{ quotationNo: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.quotation.findMany({ where, include: summaryInclude, orderBy: orderBy(q, ['quotationNo', 'createdAt', 'validUntil', 'grandTotal', 'status'], 'createdAt'), ...skipTake(q) }),
      this.prisma.quotation.count({ where }),
    ]);
    return toPage(rows.map(summary), total, q);
  }

  private async load(id: string, tx: Tx | PrismaService = this.prisma) {
    const q = await tx.quotation.findFirst({ where: { id, deletedAt: null }, include: fullInclude });
    if (!q) throw notFound('Quotation');
    return q;
  }

  async get(id: string) {
    return full(await this.load(id));
  }

  /** Server-side rate logic: lookup, override rules, line amounts, and totals. */
  private async buildLines(tx: Tx, customerId: string, lines: QuotationLineInput[]) {
    const out: Prisma.QuotationLineCreateManyQuotationVersionInput[] = [];
    let seq = 1;
    for (const line of lines) {
      const test = await tx.testMaster.findFirst({ where: { id: line.testId, deletedAt: null }, include: { method: true } });
      if (!test) throw badRequest('A selected test no longer exists', [{ field: 'lines', message: 'Unknown test' }]);
      const lookup = await this.masters.lookupRate(line.testId, customerId, istToday(), tx);
      let rate = lookup.rate;
      let rateSource: string = lookup.source ?? 'NONE';
      const asked = line.rate ?? null;
      if (asked !== null && (rate === null || Number(asked) !== Number(rate))) {
        if (!can('quotations.rateOverride')) throw forbidden('You do not have permission to override a rate');
        if (!line.overrideReason?.trim()) throw badRequest(`Give a reason for overriding the rate of ${test.name}`, [{ field: 'lines', message: 'Override reason required' }]);
        rate = asked;
        rateSource = 'OVERRIDE';
      }
      if (rate === null) throw badRequest(`No rate is set for ${test.name}. Enter one with a reason, or add a rate in Masters.`, [{ field: 'lines', message: `No rate for ${test.name}` }]);
      if (Number(rate) < 0) throw badRequest('A rate cannot be negative', [{ field: 'lines', message: 'Negative rate' }]);
      const discountPct = line.discountPct ?? '0';
      if (Number(discountPct) < 0 || Number(discountPct) > 100) throw badRequest('Discount must be between 0 and 100', [{ field: 'lines', message: 'Invalid discount' }]);
      out.push({
        seq: seq++,
        sampleDescription: line.sampleDescription,
        requiredQuantity: line.requiredQuantity ?? null,
        testId: test.id,
        testCode: test.code,
        testName: test.name,
        methodName: test.method ? [test.method.name, test.method.standardRef].filter(Boolean).join(', ') : null,
        quantity: line.quantity,
        rate,
        rateSource,
        overrideReason: rateSource === 'OVERRIDE' ? line.overrideReason : null,
        discountPct,
        amount: lineAmount(line.quantity, rate, discountPct),
      });
    }
    return out;
  }

  private async totals(tx: Tx, customerId: string, amounts: unknown[], discountPct: string) {
    const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw badRequest('Customer not found', [{ field: 'customerId', message: 'Not found' }]);
    const gstRate = await this.settings.get('tax.gstRate', tx);
    if (Number(discountPct) < 0 || Number(discountPct) > 100) throw badRequest('Discount must be between 0 and 100', [{ field: 'discountPct', message: 'Between 0 and 100' }]);
    return computeTax({ amounts: amounts as string[], discountPct, gstRate, customerStateCode: customer.stateCode, labStateCode: this.company.config.gstStateCode });
  }

  private async versionData(tx: Tx, dto: SaveQuotationDto) {
    const lines = await this.buildLines(tx, dto.customerId, dto.lines);
    const discountPct = dto.discountPct ?? '0';
    const t = await this.totals(tx, dto.customerId, lines.map((l) => l.amount), discountPct);
    const defaultTitle = await this.settings.get('quotation.defaultTitle', tx);
    const defaultTerms = await this.settings.get('quotation.defaultPaymentTerms', tx);
    const days = await this.settings.get('quotation.defaultValidityDays', tx);
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : new Date(istToday().getTime() + days * 86_400_000);
    return {
      lines,
      validUntil,
      data: {
        documentTitle: dto.documentTitle ?? defaultTitle,
        validUntil,
        estimatedDays: dto.estimatedDays ?? null,
        paymentTerms: dto.paymentTerms ?? defaultTerms,
        deliveryAddress: dto.deliveryAddress ?? this.company.config.labAddress,
        contactPerson: dto.contactPerson ?? currentUser()?.name ?? null,
        discountPct,
        subtotal: t.subtotal,
        discountAmount: t.discountAmount,
        taxableAmount: t.taxableAmount,
        gstRate: t.gstRate,
        cgst: t.cgst,
        sgst: t.sgst,
        igst: t.igst,
        roundOff: t.roundOff,
        grandTotal: t.grandTotal,
        amountInWords: t.amountInWords,
      },
    };
  }

  async create(dto: SaveQuotationDto) {
    const id = await this.prisma.$transaction(async (tx) => {
      const { lines, data, validUntil } = await this.versionData(tx, dto);
      const quotationNo = await this.numbering.next(tx, 'QUOTATION');
      const q = await tx.quotation.create({
        data: {
          quotationNo,
          customerId: dto.customerId,
          orderId: dto.orderId ?? null,
          validUntil,
          grandTotal: data.grandTotal,
          createdById: actorId(),
          versions: { create: { versionNo: 1, ...data, createdById: actorId(), lines: { createMany: { data: lines } } } },
        },
      });
      if (dto.orderId) await tx.order.updateMany({ where: { id: dto.orderId, stage: 'NEW' }, data: { stage: 'QUOTED' } });
      await this.audit.status(tx, { entity: 'Quotation', entityId: q.id, from: null, to: 'DRAFT' });
      await this.audit.record({ action: 'Quotation.create', entity: 'Quotation', entityId: q.id, after: { quotationNo, grandTotal: data.grandTotal } }, tx);
      return q.id;
    });
    return this.get(id);
  }

  /** Only a draft can be edited. Sent quotations change only through a new version. */
  async update(id: string, dto: UpdateQuotationDto) {
    await this.prisma.$transaction(async (tx) => {
      const q = await this.load(id, tx);
      if (q.status !== 'DRAFT') throw rule('NOT_EDITABLE', 'Only a draft can be edited. Revise this quotation to make changes.');
      const current = q.versions.find((v) => v.versionNo === q.currentVersionNo)!;
      const { lines, data, validUntil } = await this.versionData(tx, dto);
      const { count } = await tx.quotation.updateMany({
        where: { id, version: dto.version },
        data: { customerId: dto.customerId, orderId: dto.orderId ?? null, validUntil, grandTotal: data.grandTotal, version: { increment: 1 } },
      });
      if (count !== 1) throw conflict();
      await tx.quotationLine.deleteMany({ where: { versionId: current.id } });
      await tx.quotationVersion.update({ where: { id: current.id }, data: { ...data, lines: { createMany: { data: lines } } } });
      await this.audit.record({ action: 'Quotation.update', entity: 'Quotation', entityId: id, before: { grandTotal: str(q.grandTotal) }, after: { grandTotal: data.grandTotal } }, tx);
    });
    return this.get(id);
  }

  /** New version; the previous one stays as it was. */
  async revise(id: string, version: number, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const q = await this.load(id, tx);
      assertTransition(QUOTATION, q.status, 'DRAFT', reason);
      const prev = q.versions.find((v) => v.versionNo === q.currentVersionNo)!;
      const versionNo = q.currentVersionNo + 1;
      const { count } = await tx.quotation.updateMany({
        where: { id, version },
        data: { status: 'DRAFT', currentVersionNo: versionNo, rejectReason: null, sentAt: null, version: { increment: 1 } },
      });
      if (count !== 1) throw conflict();
      await tx.quotationVersion.create({
        data: {
          quotationId: id, versionNo, documentTitle: prev.documentTitle, validUntil: prev.validUntil, estimatedDays: prev.estimatedDays, paymentTerms: prev.paymentTerms, deliveryAddress: prev.deliveryAddress, contactPerson: prev.contactPerson,
          revisionNote: reason, discountPct: prev.discountPct, subtotal: prev.subtotal, discountAmount: prev.discountAmount, taxableAmount: prev.taxableAmount, gstRate: prev.gstRate, cgst: prev.cgst, sgst: prev.sgst, igst: prev.igst, roundOff: prev.roundOff, grandTotal: prev.grandTotal, amountInWords: prev.amountInWords,
          createdById: actorId(),
          lines: { createMany: { data: prev.lines.map(({ id: _i, versionId: _v, ...l }) => l) } },
        },
      });
      await this.audit.status(tx, { entity: 'Quotation', entityId: id, from: q.status, to: 'DRAFT', reason, meta: { versionNo } });
    });
    return this.get(id);
  }

  /** Freezes the document, then a background job renders and emails it. */
  async send(id: string, dto: SendQuotationDto) {
    const { versionId, title, quotationNo } = await this.prisma.$transaction(async (tx) => {
      const q = await this.load(id, tx);
      // Resending a sent quotation is fine; it keeps the frozen version.
      const resend = q.status === 'SENT';
      if (!resend) {
        assertTransition(QUOTATION, q.status, 'SENT');
        if (q.validUntil < istToday()) throw rule('EXPIRED', 'The validity date has passed. Change it before sending.');
      } else if (!can('quotations.send')) throw forbidden();
      const v = q.versions.find((x) => x.versionNo === q.currentVersionNo)!;
      if (!resend) {
        const { count } = await tx.quotation.updateMany({ where: { id, version: dto.version }, data: { status: 'SENT', sentAt: new Date(), version: { increment: 1 } } });
        if (count !== 1) throw conflict();
        const terms = await tx.termsVersion.findFirst({ where: { kind: 'QUOTATION' }, orderBy: { versionNo: 'desc' } });
        await tx.quotationVersion.update({
          where: { id: v.id },
          data: {
            customerSnapshot: (await customerSnapshot(tx, q.customerId)) as unknown as Prisma.InputJsonValue,
            companySnapshot: this.company.snapshot() as unknown as Prisma.InputJsonValue,
            termsSnapshot: terms?.body ?? null,
          },
        });
        await this.audit.status(tx, { entity: 'Quotation', entityId: id, from: q.status, to: 'SENT' });
      }
      return { versionId: v.id, title: v.documentTitle, quotationNo: q.quotationNo };
    });
    const job = await this.prisma.documentJob.create({
      data: {
        kind: QUOTATION_PDF,
        params: {
          versionId,
          email: {
            to: dto.to,
            cc: dto.cc ?? null,
            subject: `${title} ${quotationNo} from ${this.company.config.companyName}`,
            bodyHtml: `<p>Dear Sir/Madam,</p><p>Please find attached our ${esc(title.toLowerCase())} <strong>${esc(quotationNo)}</strong>.</p>${dto.message ? `<p>${esc(dto.message)}</p>` : ''}<p>Regards,<br>${esc(currentUser()?.name)}<br>${esc(this.company.config.companyName)}</p>`,
            template: 'quotation',
            entity: 'Quotation',
            entityId: id,
          },
        },
        createdById: actorId(),
      },
    });
    await this.documents.queueExisting(job.id);
    await this.audit.record({ action: 'Quotation.emailQueued', entity: 'Quotation', entityId: id, after: { to: dto.to, cc: dto.cc } });
    return this.get(id);
  }

  async accept(id: string, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const q = await this.load(id, tx);
      assertTransition(QUOTATION, q.status, 'ACCEPTED');
      if (q.validUntil < istToday()) throw rule('EXPIRED', `This quotation expired on ${formatDate(q.validUntil)}. Revise it to accept.`);
      const { count } = await tx.quotation.updateMany({ where: { id, version }, data: { status: 'ACCEPTED', acceptedAt: new Date(), version: { increment: 1 } } });
      if (count !== 1) throw conflict();
      if (q.orderId) await tx.order.updateMany({ where: { id: q.orderId }, data: { stage: 'WON' } });
      await this.audit.status(tx, { entity: 'Quotation', entityId: id, from: q.status, to: 'ACCEPTED' });
    });
    return this.get(id);
  }

  async reject(id: string, version: number, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const q = await this.load(id, tx);
      assertTransition(QUOTATION, q.status, 'REJECTED', reason);
      const { count } = await tx.quotation.updateMany({ where: { id, version }, data: { status: 'REJECTED', rejectReason: reason, version: { increment: 1 } } });
      if (count !== 1) throw conflict();
      if (q.orderId) await tx.order.updateMany({ where: { id: q.orderId }, data: { stage: 'LOST' } });
      await this.audit.status(tx, { entity: 'Quotation', entityId: id, from: q.status, to: 'REJECTED', reason });
    });
    return this.get(id);
  }

  /** One click from an accepted quotation to a sample request. */
  async convert(id: string) {
    if (!this.converter) throw new Error('Job module not loaded');
    return this.prisma.$transaction(async (tx) => {
      const q = await this.load(id, tx);
      if (q.status !== 'ACCEPTED') throw rule('NOT_ACCEPTED', 'Only an accepted quotation can be converted');
      if (q.jobs.length) throw rule('ALREADY_CONVERTED', 'This quotation has already been converted');
      return this.converter!(tx, id);
    });
  }

  /** Scheduled: automatic expiry after the validity date. */
  async expireOverdue(today: Date = istToday()): Promise<number> {
    const due = await this.prisma.quotation.findMany({ where: { status: 'SENT', validUntil: { lt: today }, deletedAt: null }, select: { id: true } });
    for (const { id } of due) {
      await this.prisma.$transaction(async (tx) => {
        assertSystemTransition(QUOTATION, 'SENT', 'EXPIRED');
        const { count } = await tx.quotation.updateMany({ where: { id, status: 'SENT' }, data: { status: 'EXPIRED', version: { increment: 1 } } });
        if (count) await this.audit.status(tx, { entity: 'Quotation', entityId: id, from: 'SENT', to: 'EXPIRED', reason: 'Validity date passed' });
      });
    }
    return due.length;
  }

  emails(id: string) {
    return this.prisma.emailLog.findMany({
      where: { entity: 'Quotation', entityId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, toAddress: true, ccAddress: true, subject: true, template: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
    });
  }

  history(id: string) {
    return this.prisma.statusEvent.findMany({ where: { entity: 'Quotation', entityId: id }, orderBy: { at: 'desc' } });
  }

  /** Preview for a draft: the same template the PDF uses. */
  preview(versionId: string) {
    return this.renderHtml(versionId);
  }
}

