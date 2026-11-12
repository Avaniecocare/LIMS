import { Injectable } from '@nestjs/common';
import { actorId, can, currentUser } from '../../common/context.js';
import { badRequest, forbidden, notFound, rule } from '../../common/errors.js';
import { formatDate, formatINR, istToday } from '../../common/india.js';
import type { CompanySnapshot } from '../../config/company.config.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { ModulesService } from '../../core/modules.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { WhatsappService, whatsappNumber, type WhatsappInput } from '../../core/whatsapp.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { EInvoiceService } from '../einvoice/einvoice.service.js';
import { daysOverdue } from '../invoices/ageing.js';
import { balanceOf } from '../invoices/invoices.service.js';
import type { WhatsappSendDto } from './whatsapp.dto.js';

const ENTITY = { report: 'Report', invoice: 'Invoice', reminder: 'Invoice', acknowledgement: 'Job' } as const;
/** Who may send each kind: the same people who may email it. */
const SEND_PERMS: Record<WhatsappSendDto['kind'], string[]> = {
  report: ['reports.issue'],
  invoice: ['invoices.edit'],
  reminder: ['reminders.send'],
  acknowledgement: ['jobs.create', 'jobs.edit'],
};
/** Who may see what was sent: the same people who may see the record. */
const VIEW_PERMS: Record<string, string[]> = { Report: ['reports.view'], Invoice: ['invoices.view'], Job: ['jobs.view'] };
const OPEN = ['ISSUED', 'PARTIALLY_PAID'];

/** Builds each customer message from its record and hands it to WhatsApp, with the PDF where there is one. */
@Injectable()
export class WhatsappSendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly modules: ModulesService,
    private readonly documents: DocumentsService,
    private readonly company: CompanyService,
    private readonly audit: AuditService,
    private readonly einvoice: EInvoiceService,
  ) {}

  async send(dto: WhatsappSendDto) {
    if (!SEND_PERMS[dto.kind].some((p) => can(p))) throw forbidden();
    await this.modules.require('whatsapp');
    if (dto.kind === 'invoice' || dto.kind === 'reminder') await this.modules.require('billing');
    const to = whatsappNumber(dto.to);
    if (!to) throw badRequest('Enter a WhatsApp mobile number, with the country code for numbers outside India', [{ field: 'to', message: 'Not a mobile number' }]);
    const greet = dto.contactName?.trim() || null;
    const base = { to, entity: ENTITY[dto.kind], entityId: dto.entityId, consentConfirmedBy: currentUser()!.name, createdById: actorId() };

    if (dto.kind === 'report') {
      const r = await this.prisma.report.findFirst({
        where: { id: dto.entityId },
        include: { sample: { select: { sampleNo: true } }, revisions: { where: { status: 'ISSUED' }, orderBy: { revisionNo: 'desc' }, take: 1 } },
      });
      if (!r) throw notFound('Report');
      const rev = r.revisions[0];
      if (!rev?.pdfFileId) throw rule('NOT_ISSUED', 'Only an issued report can be sent');
      const company = rev.companySnapshot as unknown as CompanySnapshot;
      const content = rev.content as unknown as { customer?: { kindAttention?: string | null; name?: string } };
      await this.whatsapp.enqueue({
        ...base,
        kind: 'report',
        values: {
          ...this.lab(company),
          contactName: greet ?? content.customer?.kindAttention ?? 'Sir/Madam',
          customerName: content.customer?.name,
          reportNo: r.reportNo,
          sampleNo: r.sample.sampleNo,
          issuedOn: formatDate(rev.issuedAt),
        },
        documentFileId: rev.pdfFileId,
        documentName: `Report ${r.reportNo}${rev.revisionNo ? ` rev ${rev.revisionNo}` : ''}.pdf`.replace(/[/\\]/g, '-'),
      });
    } else if (dto.kind === 'invoice' || dto.kind === 'reminder') {
      const inv = await this.prisma.invoice.findFirst({ where: { id: dto.entityId, deletedAt: null }, include: { einvoice: true } });
      if (!inv) throw notFound('Invoice');
      // The invoice PDF goes with both kinds; a B2B invoice is not sent before it has its IRN (as for email).
      if ((await this.einvoice.requiredFor(inv.customerSnapshot as never, inv.customerId)) && inv.einvoice?.status !== 'GENERATED')
        throw rule('IRN_MISSING', 'This invoice must be registered at the GST portal (IRN) before it is sent. Register it from the invoice page first.');
      const company = inv.companySnapshot as unknown as CompanySnapshot;
      const common = {
        ...this.lab(company),
        contactName: greet ?? 'Sir/Madam',
        customerName: (inv.customerSnapshot as { name?: string } | null)?.name,
        invoiceNo: inv.invoiceNo,
        dueDate: formatDate(inv.dueDate),
      };
      if (dto.kind === 'invoice') {
        if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') throw rule('NOT_ISSUED', 'Only an issued invoice can be sent');
        await this.viaDocument(
          'invoice-pdf',
          { invoiceId: inv.id },
          { ...base, kind: 'invoice', values: { ...common, amount: `₹${formatINR(inv.grandTotal)}`, invoiceDate: formatDate(inv.invoiceDate) } },
        );
      } else {
        if (!OPEN.includes(inv.status)) throw rule('NOT_DUE', 'Only unpaid invoices can be reminded');
        await this.whatsapp.enqueue({
          ...base,
          kind: 'reminder',
          values: { ...common, balance: `₹${formatINR(balanceOf(inv).toFixed(2))}`, daysOverdue: inv.dueDate ? Math.max(0, daysOverdue(inv.dueDate, istToday())) : 0 },
        });
        await this.prisma.reminderLog.create({ data: { invoiceId: inv.id, kind: 'MANUAL', sentById: actorId() } });
      }
    } else {
      const job = await this.prisma.job.findFirst({ where: { id: dto.entityId, deletedAt: null }, include: { customer: { select: { name: true } }, _count: { select: { samples: true } } } });
      if (!job) throw notFound('Job');
      await this.viaDocument(
        'job-acknowledgement',
        { jobId: job.id, ...(dto.photoIds?.length ? { photoIds: dto.photoIds } : {}) },
        {
          ...base,
          kind: 'acknowledgement',
          values: {
            ...this.lab(this.company.config),
            contactName: greet ?? job.kindAttention ?? 'Sir/Madam',
            customerName: job.customer.name,
            jobNo: job.jobNo,
            sampleCount: job._count.samples,
            receivedOn: formatDate(job.receivedAt),
          },
        },
      );
    }
    await this.audit.record({ action: `whatsapp.${dto.kind}.queued`, entity: base.entity, entityId: dto.entityId, after: { to, consentConfirmedBy: base.consentConfirmedBy } });
    return { ok: true };
  }

  private lab(company: { companyName: string; phone?: string | null }) {
    return { labName: company.companyName, labPhone: company.phone ?? null };
  }

  /** The PDF is rendered in the background, then sent. */
  private async viaDocument(kind: string, params: Record<string, unknown>, message: WhatsappInput) {
    if (!this.whatsapp.configured) throw rule('WHATSAPP_OFF', 'WhatsApp is not set up for this laboratory.');
    await this.documents.enqueue(kind, { ...params, whatsapp: message });
  }

  /** The send panel: whether WhatsApp is on, the customer's numbers, and what was sent before. */
  async panel(entity: string, entityId: string) {
    const perms = VIEW_PERMS[entity];
    if (!perms) throw badRequest('Unknown record', [{ field: 'entity', message: 'Report, Invoice or Job' }]);
    if (!perms.some((p) => can(p))) throw forbidden();
    const available = await this.modules.isOn('whatsapp');
    const customerId = await this.customerOf(entity, entityId);
    // Phone numbers are customer identity: only people who may see customers get them suggested.
    const contacts =
      customerId && can('customers.view')
        ? (
            await this.prisma.customerContact.findMany({
              where: { customerId, deletedAt: null, phone: { not: null } },
              orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
              select: { name: true, phone: true },
            })
          ).map((c) => ({ name: c.name, phone: c.phone! }))
        : [];
    const seeNumbers = can('customers.view');
    const messages = (await this.whatsapp.log(entity, entityId)).map((m) => ({ ...m, toNumber: seeNumbers ? m.toNumber : `••••${m.toNumber.slice(-4)}` }));
    return { available, contacts, messages };
  }

  private async customerOf(entity: string, id: string): Promise<string | null> {
    if (entity === 'Invoice') return (await this.prisma.invoice.findFirst({ where: { id }, select: { customerId: true } }))?.customerId ?? null;
    if (entity === 'Job') return (await this.prisma.job.findFirst({ where: { id }, select: { customerId: true } }))?.customerId ?? null;
    const r = await this.prisma.report.findFirst({ where: { id }, select: { sample: { select: { job: { select: { customerId: true } } } } } });
    return r?.sample.job.customerId ?? null;
  }
}
