import { Injectable, OnModuleInit } from '@nestjs/common';
import { actorId, can } from '../../common/context.js';
import { badRequest, notFound, rule } from '../../common/errors.js';
import { istToday } from '../../common/india.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import type { CompanySnapshot } from '../../config/company.config.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, updateVersioned } from '../../core/prisma.service.js';
import { DocumentsService, requirePermission } from '../documents/documents.service.js';
import { PdfService } from '../pdf/pdf.service.js';
import { challanHtml } from '../pdf/templates/commercial.js';
import { customerSnapshot } from '../quotations/quotations.service.js';
import type { CreateDispatchDto, DispatchQuery, ReturnableQuery, SampleDisposeDto, SampleReturnDto } from './dispatch.dto.js';

const include = { job: { select: { jobNo: true, customer: { select: { name: true } } } } } as const;
type Row = Prisma.DispatchGetPayload<{ include: typeof include }>;

@Injectable()
export class DispatchService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly company: CompanyService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
  ) {}

  onModuleInit() {
    this.documents.register('dispatch-challan', {
      authorize: requirePermission('dispatch.view'),
      run: async (p) => {
        const d = await this.prisma.dispatch.findUniqueOrThrow({ where: { id: String(p.dispatchId) }, include: { job: { include: { customer: true } } } });
        const company = d.companySnapshot as unknown as CompanySnapshot;
        const customer = await customerSnapshot(this.prisma as never, d.job.customerId);
        const html = challanHtml({ ...d, jobNo: d.job.jobNo, customerName: d.job.customer.name, address: d.job.reportIssueAddress ?? customer.reportAddress, items: d.items as never, company });
        return {
          buffer: await this.pdf.render(html, { company }),
          filename: `Dispatch Challan ${d.dispatchNo}.pdf`.replace(/[/\\]/g, '-'),
          mimeType: 'application/pdf',
          entity: 'Dispatch',
          entityId: d.id,
        };
      },
    });
  }

  private dto(d: Row) {
    return {
      id: d.id,
      dispatchNo: d.dispatchNo,
      jobId: d.jobId,
      jobNo: d.job.jobNo,
      customerName: can('customers.view') ? d.job.customer.name : null,
      dispatchDate: d.dispatchDate,
      modeId: d.modeId,
      modeLabel: d.modeLabel,
      courierName: d.courierName,
      carrierName: d.carrierName,
      docketNo: d.docketNo,
      carrierContact: d.carrierContact,
      remarks: d.remarks,
      items: d.items as never,
      createdAt: d.createdAt,
    };
  }

  async list(q: DispatchQuery) {
    const where: Prisma.DispatchWhereInput = {
      deletedAt: null,
      ...(q.jobId ? { jobId: q.jobId } : {}),
      ...(q.from || q.to ? { dispatchDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.q
        ? { OR: [{ dispatchNo: { contains: q.q, mode: 'insensitive' } }, { docketNo: { contains: q.q, mode: 'insensitive' } }, { job: { jobNo: { contains: q.q, mode: 'insensitive' } } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.dispatch.findMany({ where, include, orderBy: orderBy(q, ['dispatchNo', 'dispatchDate'], 'dispatchDate'), ...skipTake(q) }),
      this.prisma.dispatch.count({ where }),
    ]);
    return toPage(
      rows.map((r) => this.dto(r)),
      total,
      q,
    );
  }

  async get(id: string) {
    const d = await this.prisma.dispatch.findFirst({ where: { id, deletedAt: null }, include });
    if (!d) throw notFound('Dispatch');
    return this.dto(d);
  }

  /** Jobs with something left to send: an issued report or a returnable sample not yet returned. */
  async pending(q: DispatchQuery) {
    const where: Prisma.JobWhereInput = {
      deletedAt: null,
      status: { not: 'CANCELLED' },
      ...(q.jobId ? { id: q.jobId } : {}),
      OR: [{ samples: { some: { reports: { some: { revisions: { some: { status: 'ISSUED' } } } } } } }, { samples: { some: { returnable: true, returnedAt: null, status: { not: 'CANCELLED' } } } }],
      ...(q.q ? { jobNo: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const rows = await this.prisma.job.findMany({
      where,
      include: {
        customer: { select: { name: true, withholdReportUntilPaid: true } },
        invoiceLines: { select: { invoice: { select: { status: true } } } },
        samples: { where: { status: { not: 'CANCELLED' } }, include: { reports: { include: { revisions: { where: { status: 'ISSUED' }, select: { revisionNo: true } } } } } },
      },
      orderBy: { receivedAt: 'asc' },
      take: 500,
    });
    // Only the dispatches of these jobs, not every dispatch ever made.
    const sentReports = new Set<string>();
    const sentSamples = new Set<string>();
    const dispatches = await this.prisma.dispatch.findMany({ where: { deletedAt: null, jobId: { in: rows.map((r) => r.id) } }, select: { items: true } });
    for (const d of dispatches) for (const it of d.items as { kind: string; id: string }[]) (it.kind === 'Report' ? sentReports : sentSamples).add(it.id);
    const identity = can('customers.view');
    const data = rows
      .map((j) => {
        const invoices = j.invoiceLines.map((l) => l.invoice).filter((i) => !['CANCELLED', 'DRAFT'].includes(i.status));
        const withheld = j.customer.withholdReportUntilPaid && (invoices.length === 0 || invoices.some((i) => i.status !== 'PAID'));
        return {
          jobId: j.id,
          jobNo: j.jobNo,
          customerName: identity ? j.customer.name : null,
          reports: j.samples.flatMap((s) =>
            s.reports.filter((r) => r.revisions.length && !sentReports.has(r.id)).map((r) => ({ reportId: r.id, reportNo: r.reportNo, revisionNo: r.revisions[0].revisionNo, withheld })),
          ),
          returnableSamples: j.samples.filter((s) => s.returnable && !s.returnedAt && !sentSamples.has(s.id)).map((s) => ({ sampleId: s.id, sampleNo: s.sampleNo, description: s.description })),
        };
      })
      .filter((j) => j.reports.length || j.returnableSamples.length);
    const { skip, take } = skipTake(q);
    return toPage(data.slice(skip, skip + take), data.length, q);
  }

  async create(dto: CreateDispatchDto) {
    if (!dto.reportIds?.length && !dto.sampleIds?.length) throw badRequest('Choose at least one report or sample', [{ field: 'reportIds', message: 'Nothing selected' }]);
    const id = await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findFirst({ where: { id: dto.jobId, deletedAt: null }, include: { customer: true, invoiceLines: { select: { invoice: { select: { status: true } } } } } });
      if (!job) throw notFound('Job');
      if (job.status === 'CANCELLED') throw rule('JOB_CANCELLED', 'This job has been cancelled');
      const mode = await tx.lookupValue.findFirst({ where: { id: dto.modeId, kind: 'DISPATCH_MODE', deletedAt: null } });
      if (!mode) throw badRequest('Unknown dispatch mode', [{ field: 'modeId', message: 'Unknown mode' }]);
      if (mode.code === 'COURIER' && (!dto.courierName?.trim() || !dto.docketNo?.trim()))
        throw badRequest('Enter the courier and docket number', [
          ...(!dto.courierName?.trim() ? [{ field: 'courierName', message: 'Required for courier' }] : []),
          ...(!dto.docketNo?.trim() ? [{ field: 'docketNo', message: 'Required for courier' }] : []),
        ]);
      if (mode.code === 'BY_HAND' && (!dto.carrierName?.trim() || !dto.carrierContact?.trim()))
        throw badRequest('Enter the person carrying it and their contact details', [
          ...(!dto.carrierName?.trim() ? [{ field: 'carrierName', message: 'Required when sent by hand' }] : []),
          ...(!dto.carrierContact?.trim() ? [{ field: 'carrierContact', message: 'Required when sent by hand' }] : []),
        ]);
      const items: { kind: string; id: string; reference: string; description: string }[] = [];
      if (dto.reportIds?.length) {
        const invoices = job.invoiceLines.map((l) => l.invoice).filter((i) => !['CANCELLED', 'DRAFT'].includes(i.status));
        if (job.customer.withholdReportUntilPaid && (invoices.length === 0 || invoices.some((i) => i.status !== 'PAID')))
          throw rule('WITHHELD', 'This customer has report release withheld until payment is received');
        const reports = await tx.report.findMany({ where: { id: { in: dto.reportIds }, sample: { jobId: dto.jobId } }, include: { sample: true, revisions: { where: { status: 'ISSUED' } } } });
        if (reports.length !== dto.reportIds.length) throw badRequest('A report is not on this job', [{ field: 'reportIds', message: 'Not on this job' }]);
        for (const r of reports) {
          if (!r.revisions.length) throw rule('NOT_ISSUED', `${r.reportNo} has not been issued`);
          items.push({ kind: 'Report', id: r.id, reference: `${r.reportNo}${r.revisions[0].revisionNo ? ` R${r.revisions[0].revisionNo}` : ''}`, description: r.sample.description });
        }
      }
      if (dto.sampleIds?.length) {
        const samples = await tx.sample.findMany({ where: { id: { in: dto.sampleIds }, jobId: dto.jobId } });
        if (samples.length !== dto.sampleIds.length) throw badRequest('A sample is not on this job', [{ field: 'sampleIds', message: 'Not on this job' }]);
        for (const s of samples) {
          if (!s.returnable) throw rule('NOT_RETURNABLE', `${s.sampleNo} is not returnable`);
          items.push({ kind: 'Sample', id: s.id, reference: s.sampleNo, description: s.description });
          await tx.sample.update({ where: { id: s.id }, data: { returnedAt: new Date(dto.dispatchDate), returnStatus: 'Returned with dispatch', version: { increment: 1 } } });
        }
      }
      const dispatchNo = await this.numbering.next(tx, 'DISPATCH', new Date(dto.dispatchDate));
      const d = await tx.dispatch.create({
        data: {
          dispatchNo,
          jobId: dto.jobId,
          dispatchDate: new Date(dto.dispatchDate),
          modeId: mode.id,
          modeLabel: mode.label,
          courierName: dto.courierName,
          carrierName: dto.carrierName,
          docketNo: dto.docketNo,
          carrierContact: dto.carrierContact,
          remarks: dto.remarks,
          items: items as Prisma.InputJsonValue,
          companySnapshot: this.company.snapshot() as unknown as Prisma.InputJsonValue,
          createdById: actorId(),
          isDemo: job.isDemo,
        },
      });
      await this.audit.record({ action: 'Dispatch.create', entity: 'Dispatch', entityId: d.id, after: { dispatchNo, items } }, tx);
      await this.audit.status(tx, { entity: 'Dispatch', entityId: d.id, from: null, to: 'DISPATCHED', jobId: dto.jobId, meta: { dispatchNo } });
      return d.id;
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- returnable samples & retention
  async returnables(q: ReturnableQuery) {
    const today = istToday();
    const view = q.view ?? 'pending';
    const where: Prisma.SampleWhereInput = {
      deletedAt: null,
      ...(view === 'pending' ? { returnable: true, returnedAt: null, status: { not: 'CANCELLED' } } : {}),
      ...(view === 'returned' ? { returnedAt: { not: null } } : {}),
      ...(view === 'disposed' ? { disposedAt: { not: null } } : {}),
      ...(view === 'due-for-disposal' ? { disposedAt: null, returnedAt: null, retentionUntil: { lt: today } } : {}),
      ...(q.q ? { OR: [{ sampleNo: { contains: q.q, mode: 'insensitive' } }, { job: { jobNo: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const identity = can('customers.view');
    const [rows, total] = await Promise.all([
      this.prisma.sample.findMany({
        where,
        include: { job: { select: { jobNo: true, customer: { select: { name: true } } } } },
        orderBy: orderBy(q, ['sampleNo', 'retentionUntil', 'createdAt'], 'createdAt', 'asc'),
        ...skipTake(q),
      }),
      this.prisma.sample.count({ where }),
    ]);
    return toPage(
      rows.map((s) => ({
        id: s.id,
        sampleNo: s.sampleNo,
        description: s.description,
        jobId: s.jobId,
        jobNo: s.job.jobNo,
        customerName: identity ? s.job.customer.name : null,
        returnable: s.returnable,
        returnStatus: s.returnStatus,
        returnedAt: s.returnedAt,
        retentionUntil: s.retentionUntil,
        disposedAt: s.disposedAt,
        status: s.status,
        version: s.version,
        dueForDisposal: !s.disposedAt && !s.returnedAt && !!s.retentionUntil && s.retentionUntil < today,
      })),
      total,
      q,
    );
  }

  async markReturned(id: string, dto: SampleReturnDto) {
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.sample.findFirst({ where: { id, deletedAt: null } });
      if (!s) throw notFound('Sample');
      if (!s.returnable) throw rule('NOT_RETURNABLE', 'This sample is not marked as returnable');
      if (s.disposedAt) throw rule('DISPOSED', 'This sample has already been disposed of');
      await updateVersioned(tx.sample as never, id, dto.version, { returnedAt: new Date(dto.returnedAt), returnStatus: dto.returnStatus });
      await this.audit.record({ action: 'Sample.returned', entity: 'Sample', entityId: id, after: dto }, tx);
    });
    return { ok: true };
  }

  async markDisposed(id: string, dto: SampleDisposeDto) {
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.sample.findFirst({ where: { id, deletedAt: null } });
      if (!s) throw notFound('Sample');
      if (s.returnedAt) throw rule('RETURNED', 'This sample was returned to the customer');
      await updateVersioned(tx.sample as never, id, dto.version, { disposedAt: new Date(dto.disposedAt) });
      await this.audit.record({ action: 'Sample.disposed', entity: 'Sample', entityId: id, after: dto }, tx);
    });
    return { ok: true };
  }
}
