import { Injectable, OnModuleInit } from '@nestjs/common';
import QRCode from 'qrcode';
import { actorId, can, currentUser } from '../../common/context.js';
import { badRequest, conflict, forbidden, notFound, reasonRequired, rule } from '../../common/errors.js';
import { istToday } from '../../common/india.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { assertSystemTransition, assertTransition, JOB } from '../../common/workflow.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, updateVersioned, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { StorageService } from '../../core/storage.service.js';
import { DocumentsService, requirePermission } from '../documents/documents.service.js';
import { MastersService } from '../masters/masters.service.js';
import { PdfService } from '../pdf/pdf.service.js';
import { esc } from '../pdf/templates/base.js';
import { acknowledgementHtml, labelsHtml, srfHtml, type JobDocument } from '../pdf/templates/job-documents.js';
import { QuotationsService } from '../quotations/quotations.service.js';
import type { AddDeviationDto, CreateJobDto, JobQuery, SampleInput, SampleQuery, SendAckDto, UpdateJobDto, UpdateSampleDto } from './jobs.dto.js';

const jobInclude = {
  customer: { select: { id: true, name: true, crn: true } },
  deviations: { orderBy: { createdAt: 'asc' } },
  samples: {
    orderBy: { sampleNo: 'asc' },
    include: {
      attributes: true,
      tests: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { assignedTo: { select: { name: true } } } },
    },
  },
  _count: { select: { samples: true } },
} as const;
type JobRow = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

const summaryInclude = { customer: { select: { id: true, name: true, crn: true } }, _count: { select: { samples: true } } } as const;
type JobSummaryRow = Prisma.JobGetPayload<{ include: typeof summaryInclude }>;

/** Impartiality: customer identity is only ever serialised for roles allowed to see it. */
function customerFields(j: { customer: { id: string; name: string; crn: string } }) {
  return can('customers.view') ? { customerId: j.customer.id, customerName: j.customer.name, crn: j.customer.crn } : { customerId: null, customerName: null, crn: null };
}

const jobSummary = (j: JobSummaryRow) => ({
  id: j.id, jobNo: j.jobNo, ...customerFields(j), status: j.status, urgent: j.urgent, receivedAt: j.receivedAt, sampleCount: j._count.samples, quotationId: can('quotations.view') ? j.quotationId : null, holdReason: j.holdReason, cancelReason: j.cancelReason, version: j.version,
});

const jobFull = (j: JobRow) => {
  const identity = can('customers.view');
  return {
    ...jobSummary(j),
    noQuotationReason: j.noQuotationReason, letterRef: identity ? j.letterRef : null, letterDate: j.letterDate, materialSpec: j.materialSpec, poNumber: identity ? j.poNumber : null, poDate: identity ? j.poDate : null, receiptModeId: j.receiptModeId,
    reportIssueDetails: identity ? j.reportIssueDetails : null, reportIssueAddress: identity ? j.reportIssueAddress : null, kindAttention: identity ? j.kindAttention : null, contactEmail: identity ? j.contactEmail : null, contactPhone: identity ? j.contactPhone : null,
    sampleDrawnByLab: j.sampleDrawnByLab, statusBeforeHold: j.statusBeforeHold,
    deviations: j.deviations.map((d) => ({ id: d.id, sampleId: d.sampleId, typeId: d.typeId, typeLabel: d.typeLabel, remark: d.remark, createdAt: d.createdAt })),
    samples: j.samples.map((s) => ({
      id: s.id, sampleNo: s.sampleNo, jobId: s.jobId, description: s.description, condition: s.condition, quantity: s.quantity, size: s.size, returnable: s.returnable, status: s.status, cancelReason: s.cancelReason,
      retentionUntil: s.retentionUntil, returnStatus: s.returnStatus, returnedAt: s.returnedAt, disposedAt: s.disposedAt, specificationId: s.specificationId, dualSpecificationId: s.dualSpecificationId, version: s.version,
      attributes: s.attributes.map((a) => ({ id: a.id, label: a.label, value: a.value })),
      tests: s.tests.map((t) => ({ id: t.id, testId: t.testId, testCode: t.testCode, testName: t.testName, status: t.status, planned: !!t.plannedAt, dueDate: t.dueDate, assignedToName: t.assignedTo?.name ?? null, version: t.version })),
    })),
  };
};

const ACTIVE_TEST = { deletedAt: null, status: { not: 'CANCELLED' } } as const;

@Injectable()
export class JobsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly company: CompanyService,
    private readonly masters: MastersService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly quotations: QuotationsService,
  ) {}

  onModuleInit() {
    this.quotations.converter = (tx, quotationId) => this.fromQuotation(tx, quotationId);
    const jobDoc = (kind: string, title: string, html: (j: JobDocument) => string) =>
      this.documents.register(kind, {
        // These print the customer's name and contacts, so viewing jobs alone is not enough.
        authorize: requirePermission('customers.view'),
        run: async (p) => {
          const j = await this.jobDocument(String(p.jobId));
          return { buffer: await this.pdf.render(html(j), { company: this.company.snapshot() }), filename: `${title} ${j.jobNo}.pdf`.replace(/[/\\]/g, '-'), mimeType: 'application/pdf', entity: 'Job', entityId: String(p.jobId) };
        },
      });
    jobDoc('job-srf', 'SRF', (j) => srfHtml(j, this.company.snapshot()));
    jobDoc('job-acknowledgement', 'Acknowledgement', (j) => acknowledgementHtml(j, this.company.snapshot()));
    this.documents.register('sample-labels', {
      authorize: requirePermission('jobs.view'),
      run: async (p) => {
        const job = await this.prisma.job.findUniqueOrThrow({ where: { id: String(p.jobId) }, include: { samples: { where: { status: { not: 'CANCELLED' }, ...(p.sampleId ? { id: String(p.sampleId) } : {}) }, orderBy: { sampleNo: 'asc' } } } });
        const labels = await Promise.all(
          job.samples.map(async (s) => ({ sampleNo: s.sampleNo, jobNo: job.jobNo, description: s.description, urgent: job.urgent, returnable: s.returnable, receivedAt: job.receivedAt, qrDataUri: await QRCode.toDataURL(s.sampleNo, { margin: 0, width: 240, errorCorrectionLevel: 'M' }) })),
        );
        const company = this.company.snapshot();
        return {
          buffer: await this.pdf.render(labelsHtml(labels, company), { company, width: '70mm', height: '40mm', footer: false, margin: { top: '2mm', bottom: '2mm', left: '2mm', right: '2mm' } }),
          filename: `Labels ${job.jobNo}.pdf`.replace(/[/\\]/g, '-'),
          mimeType: 'application/pdf',
          entity: 'Job',
          entityId: job.id,
        };
      },
    });
    this.documents.register('letter-combine', {
      authorize: requirePermission('jobs.create', 'jobs.edit'),
      run: async (p) => {
        const images = await Promise.all((p.fileIds as string[]).map(async (id) => {
          const f = await this.storage.read(id);
          return { bytes: f.buffer, mimeType: f.mimeType };
        }));
        return { buffer: await this.pdf.mergeImagesToPdf(images), filename: 'Customer letter.pdf', mimeType: 'application/pdf', entity: 'Job', entityId: String(p.jobId), category: 'letter' };
      },
    });
  }

  private async jobDocument(jobId: string): Promise<JobDocument> {
    const j = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
    const receiptMode = j.receiptModeId ? await this.prisma.lookupValue.findUnique({ where: { id: j.receiptModeId } }) : null;
    const receivedBy = j.receivedById ? await this.prisma.user.findUnique({ where: { id: j.receivedById } }) : null;
    const sampleNos = new Map(j.samples.map((s) => [s.id, s.sampleNo]));
    return {
      jobNo: j.jobNo, receivedAt: j.receivedAt, urgent: j.urgent, letterRef: j.letterRef, letterDate: j.letterDate, materialSpec: j.materialSpec, poNumber: j.poNumber, poDate: j.poDate, receiptMode: receiptMode?.label ?? null,
      reportIssueDetails: j.reportIssueDetails, reportIssueAddress: j.reportIssueAddress, kindAttention: j.kindAttention, contactEmail: j.contactEmail, contactPhone: j.contactPhone, customerName: j.customer.name, crn: j.customer.crn, receivedBy: receivedBy?.name ?? null,
      samples: j.samples.map((s) => ({ sampleNo: s.sampleNo, description: s.description, condition: s.condition, quantity: s.quantity, size: s.size, returnable: s.returnable, attributes: s.attributes, tests: s.tests.filter((t) => t.status !== 'CANCELLED').map((t) => t.testName) })),
      deviations: j.deviations.map((d) => ({ sampleNo: d.sampleId ? (sampleNos.get(d.sampleId) ?? null) : null, typeLabel: d.typeLabel, remark: d.remark })),
    };
  }

  // ---------------------------------------------------------------- reads
  async list(q: JobQuery) {
    const identity = can('customers.view');
    const where: Prisma.JobWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.urgent === 'true' ? { urgent: true } : {}),
      ...(q.from || q.to ? { receivedAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999+05:30`) } : {}) } } : {}),
      ...(q.q ? { OR: [{ jobNo: { contains: q.q, mode: 'insensitive' } }, ...(identity ? [{ customer: { name: { contains: q.q, mode: 'insensitive' as const } } }] : [])] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({ where, include: summaryInclude, orderBy: orderBy(q, ['jobNo', 'receivedAt', 'status'], 'receivedAt'), ...skipTake(q) }),
      this.prisma.job.count({ where }),
    ]);
    return toPage(rows.map(jobSummary), total, q);
  }

  async listSamples(q: SampleQuery) {
    const identity = can('customers.view');
    const where: Prisma.SampleWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.returnable === 'true' ? { returnable: true } : q.returnable === 'false' ? { returnable: false } : {}),
      ...(q.urgent === 'true' ? { job: { urgent: true } } : q.urgent === 'false' ? { job: { urgent: false } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999+05:30`) } : {}) } } : {}),
      ...(q.q ? { OR: [{ sampleNo: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }, { job: { jobNo: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sample.findMany({ where, include: { job: { select: { jobNo: true, urgent: true, receivedAt: true, customer: { select: { name: true } } } } }, orderBy: orderBy(q, ['sampleNo', 'createdAt', 'status'], 'createdAt'), ...skipTake(q) }),
      this.prisma.sample.count({ where }),
    ]);
    return toPage(
      rows.map((s) => ({ id: s.id, sampleNo: s.sampleNo, jobId: s.jobId, jobNo: s.job.jobNo, description: s.description, status: s.status, returnable: s.returnable, urgent: s.job.urgent, receivedAt: s.job.receivedAt, customerName: identity ? s.job.customer.name : null })),
      total,
      q,
    );
  }

  private async loadJob(id: string, tx: Tx | PrismaService = this.prisma) {
    const j = await tx.job.findFirst({ where: { id, deletedAt: null }, include: jobInclude });
    if (!j) throw notFound('Job');
    return j;
  }

  async get(id: string) {
    return jobFull(await this.loadJob(id));
  }

  /** Every stage, person and time across the job and its samples, tests and reports. */
  async timeline(jobId: string) {
    await this.loadJob(jobId);
    const events = await this.prisma.statusEvent.findMany({ where: { jobId }, orderBy: { at: 'asc' } });
    const tests = await this.prisma.sampleTest.findMany({ where: { sample: { jobId } }, select: { id: true, testName: true, sample: { select: { sampleNo: true } } } });
    const samples = await this.prisma.sample.findMany({ where: { jobId }, select: { id: true, sampleNo: true } });
    const stages = await this.prisma.sampleTestStage.findMany({ where: { sampleTestId: { in: tests.map((t) => t.id) }, completedAt: { not: null } } });
    const labels = new Map<string, string>([...tests.map((t) => [t.id, `${t.sample.sampleNo} · ${t.testName}`] as const), ...samples.map((s) => [s.id, s.sampleNo] as const)]);
    const reports = await this.prisma.report.findMany({ where: { sample: { jobId } }, select: { id: true, reportNo: true } });
    for (const r of reports) labels.set(r.id, r.reportNo);
    const merged = [
      ...events.map((e) => ({ id: e.id, entity: e.entity, entityId: e.entityId, label: labels.get(e.entityId) ?? null, fromStatus: e.fromStatus, toStatus: e.toStatus, reason: e.reason, byName: e.byName, at: e.at })),
      ...stages.map((s) => ({ id: s.id, entity: 'Stage', entityId: s.sampleTestId, label: labels.get(s.sampleTestId) ?? null, fromStatus: null, toStatus: s.name, reason: null, byName: s.completedByName, at: s.completedAt! })),
    ];
    return merged.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  async auditHistory(entity: string, entityId: string) {
    const rows = await this.prisma.auditLog.findMany({ where: { entity, entityId }, orderBy: { at: 'desc' }, take: 200 });
    return rows.map((r) => ({ id: r.id.toString(), at: r.at, userName: r.userName, action: r.action, before: r.before, after: r.after, reason: r.reason }));
  }

  // ---------------------------------------------------------------- booking
  private async assertLookups(tx: Tx, dto: { receiptModeId?: string | null; deviations?: { typeId: string; sampleIndex?: number | null }[]; samples?: SampleInput[] }) {
    if (dto.receiptModeId) {
      const mode = await tx.lookupValue.findFirst({ where: { id: dto.receiptModeId, kind: 'RECEIPT_MODE' } });
      if (!mode) throw badRequest('Unknown receipt mode', [{ field: 'receiptModeId', message: 'Unknown receipt mode' }]);
    }
    for (const d of dto.deviations ?? []) {
      if (d.sampleIndex != null && dto.samples && d.sampleIndex >= dto.samples.length) throw badRequest('A deviation refers to a sample that does not exist', [{ field: 'deviations', message: 'Unknown sample' }]);
    }
  }

  private async retentionDate(tx: Tx): Promise<Date> {
    const days = await this.settings.get('retention.sampleDays', tx);
    return new Date(istToday().getTime() + days * 86_400_000);
  }

  private async createJobRow(tx: Tx, dto: Omit<CreateJobDto, 'noQuotationReason'> & { noQuotationReason?: string | null; quotationId?: string | null }, rates?: Map<string, { rate: string; source: string }>) {
    const customer = await tx.customer.findFirst({ where: { id: dto.customerId, deletedAt: null } });
    if (!customer) throw badRequest('Customer not found', [{ field: 'customerId', message: 'Not found' }]);
    await this.assertLookups(tx, dto);
    const jobNo = await this.numbering.next(tx, 'JOB');
    const job = await tx.job.create({
      data: {
        jobNo, customerId: dto.customerId, quotationId: dto.quotationId ?? null, noQuotationReason: dto.noQuotationReason ?? null, urgent: dto.urgent ?? false, letterRef: dto.letterRef, letterDate: dto.letterDate ? new Date(dto.letterDate) : null, materialSpec: dto.materialSpec, poNumber: dto.poNumber, poDate: dto.poDate ? new Date(dto.poDate) : null,
        receiptModeId: dto.receiptModeId, reportIssueDetails: dto.reportIssueDetails, reportIssueAddress: dto.reportIssueAddress, kindAttention: dto.kindAttention, contactEmail: dto.contactEmail, contactPhone: dto.contactPhone, sampleDrawnByLab: dto.sampleDrawnByLab ?? false, receivedById: actorId(),
      },
    });
    await this.audit.status(tx, { entity: 'Job', entityId: job.id, from: null, to: 'RECEIVED', jobId: job.id, reason: dto.noQuotationReason });
    const retentionUntil = await this.retentionDate(tx);
    const sampleIds: string[] = [];
    for (const s of dto.samples) {
      const sampleNo = await this.numbering.next(tx, 'SAMPLE');
      const sample = await tx.sample.create({
        data: { sampleNo, jobId: job.id, description: s.description, condition: s.condition, quantity: s.quantity, size: s.size, returnable: s.returnable ?? false, retentionUntil, attributes: s.attributes?.length ? { createMany: { data: s.attributes } } : undefined },
      });
      sampleIds.push(sample.id);
      await this.audit.status(tx, { entity: 'Sample', entityId: sample.id, from: null, to: 'RECEIVED', jobId: job.id });
      await this.addRequestedTests(tx, sample.id, s.testIds ?? [], dto.customerId, dto.urgent ?? false, rates);
    }
    for (const d of dto.deviations ?? []) {
      const type = await tx.lookupValue.findFirst({ where: { id: d.typeId, kind: 'DEVIATION_TYPE' } });
      if (!type) throw badRequest('Unknown deviation type', [{ field: 'deviations', message: 'Unknown deviation type' }]);
      await tx.sampleDeviation.create({ data: { jobId: job.id, sampleId: d.sampleIndex != null ? sampleIds[d.sampleIndex] : null, typeId: type.id, typeLabel: type.label, remark: d.remark, createdById: actorId() } });
    }
    await this.audit.record({ action: 'Job.create', entity: 'Job', entityId: job.id, after: { jobNo, samples: dto.samples.length, quotationId: dto.quotationId ?? null } }, tx);
    return job;
  }

  /** Requested tests stay unplanned until the planner picks them up. Rate priority: quotation, customer, standard. */
  async addRequestedTests(tx: Tx, sampleId: string, testIds: string[], customerId: string, urgent: boolean, rates?: Map<string, { rate: string; source: string }>) {
    for (const testId of testIds) {
      const test = await tx.testMaster.findFirst({ where: { id: testId, deletedAt: null }, include: { method: true } });
      if (!test) throw badRequest('A requested test no longer exists', [{ field: 'samples', message: 'Unknown test' }]);
      const fromQuote = rates?.get(testId);
      const looked = fromQuote ? null : await this.masters.lookupRate(testId, customerId, istToday(), tx);
      await tx.sampleTest.create({
        data: {
          sampleId, testId, testCode: test.code, testName: test.name, methodName: test.method ? [test.method.name, test.method.standardRef].filter(Boolean).join(', ') : null, departmentId: test.departmentId, urgent,
          rate: fromQuote?.rate ?? looked?.rate ?? null, rateSource: fromQuote ? 'QUOTATION' : (looked?.source ?? null),
        },
      });
    }
  }

  async create(dto: CreateJobDto) {
    if (!can('jobs.createWithoutQuotation')) throw forbidden('You do not have permission to book a job without a quotation');
    if (!dto.noQuotationReason?.trim()) throw reasonRequired();
    const id = await this.prisma.$transaction((tx) => this.createJobRow(tx, dto).then((j) => j.id));
    return this.get(id);
  }

  /** Accepted quotation to sample request: carries customer, samples, tests and rates across. */
  private async fromQuotation(tx: Tx, quotationId: string) {
    const q = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { lines: { orderBy: { seq: 'asc' } } } } } });
    const lines = q.versions[0].lines;
    const bySample = new Map<string, typeof lines>();
    for (const l of lines) bySample.set(l.sampleDescription, [...(bySample.get(l.sampleDescription) ?? []), l]);
    const rates = new Map(lines.map((l) => [l.testId, { rate: String(l.rate), source: 'QUOTATION' }]));
    const job = await this.createJobRow(
      tx,
      {
        customerId: q.customerId,
        quotationId,
        samples: [...bySample.entries()].map(([description, ls]) => ({ description, quantity: ls[0].requiredQuantity, testIds: [...new Set(ls.map((l) => l.testId))] })),
      },
      rates,
    );
    return { jobId: job.id, jobNo: job.jobNo };
  }

  async update(id: string, dto: UpdateJobDto) {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.loadJob(id, tx);
      if (before.status === 'CANCELLED' || before.status === 'COMPLETED') throw rule('LOCKED', 'This job can no longer be edited');
      await this.assertLookups(tx, { receiptModeId: dto.receiptModeId });
      const { version, letterDate, poDate, ...rest } = dto;
      await updateVersioned(tx.job as never, id, version, { ...rest, ...(letterDate !== undefined ? { letterDate: letterDate ? new Date(letterDate) : null } : {}), ...(poDate !== undefined ? { poDate: poDate ? new Date(poDate) : null } : {}) });
      await this.audit.record({ action: 'Job.update', entity: 'Job', entityId: id, before: { urgent: before.urgent, letterRef: before.letterRef, poNumber: before.poNumber }, after: dto }, tx);
      // An urgency change moves due dates on tests not yet locked, handled at planning.
      if (dto.urgent !== undefined && dto.urgent !== before.urgent) await tx.sampleTest.updateMany({ where: { sample: { jobId: id }, status: { notIn: ['APPROVED', 'CANCELLED'] } }, data: { urgent: dto.urgent } });
    });
    return this.get(id);
  }

  async updateSample(sampleId: string, dto: UpdateSampleDto) {
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.sample.findFirst({ where: { id: sampleId, deletedAt: null } });
      if (!s) throw notFound('Sample');
      if (s.status === 'CANCELLED' || s.status === 'COMPLETED') throw rule('LOCKED', 'This sample can no longer be edited');
      const { version, attributes, ...rest } = dto;
      await updateVersioned(tx.sample as never, sampleId, version, rest);
      if (attributes) {
        await tx.sampleAttribute.deleteMany({ where: { sampleId } });
        await tx.sampleAttribute.createMany({ data: attributes.map((a) => ({ ...a, sampleId })) });
      }
      await this.audit.record({ action: 'Sample.update', entity: 'Sample', entityId: sampleId, before: s, after: dto }, tx);
    });
    const s = await this.prisma.sample.findUniqueOrThrow({ where: { id: sampleId } });
    return this.get(s.jobId);
  }

  async addDeviation(jobId: string, dto: AddDeviationDto) {
    await this.prisma.$transaction(async (tx) => {
      await this.loadJob(jobId, tx);
      const type = await tx.lookupValue.findFirst({ where: { id: dto.typeId, kind: 'DEVIATION_TYPE' } });
      if (!type) throw badRequest('Unknown deviation type', [{ field: 'typeId', message: 'Unknown deviation type' }]);
      if (dto.sampleId && !(await tx.sample.findFirst({ where: { id: dto.sampleId, jobId } }))) throw badRequest('That sample is not on this job', [{ field: 'sampleId', message: 'Not on this job' }]);
      const d = await tx.sampleDeviation.create({ data: { jobId, sampleId: dto.sampleId ?? null, typeId: type.id, typeLabel: type.label, remark: dto.remark, createdById: actorId() } });
      await this.audit.record({ action: 'Job.deviation', entity: 'Job', entityId: jobId, after: d, reason: dto.remark }, tx);
    });
    return this.get(jobId);
  }

  // ---------------------------------------------------------------- hold
  async hold(id: string, version: number, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const j = await this.loadJob(id, tx);
      assertTransition(JOB, j.status, 'ON_HOLD', reason);
      await updateVersioned(tx.job as never, id, version, { status: 'ON_HOLD', statusBeforeHold: j.status, holdReason: reason });
      await this.audit.status(tx, { entity: 'Job', entityId: id, from: j.status, to: 'ON_HOLD', reason, jobId: id });
    });
    return this.get(id);
  }

  async release(id: string, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const j = await this.loadJob(id, tx);
      if (j.status !== 'ON_HOLD' || !j.statusBeforeHold) throw rule('NOT_ON_HOLD', 'This job is not on hold');
      assertTransition(JOB, 'ON_HOLD', j.statusBeforeHold);
      await updateVersioned(tx.job as never, id, version, { status: j.statusBeforeHold, statusBeforeHold: null, holdReason: null });
      await this.audit.status(tx, { entity: 'Job', entityId: id, from: 'ON_HOLD', to: j.statusBeforeHold, jobId: id });
      await this.syncStatus(tx, id);
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- status roll-up
  /**
   * Sample and job status follow from their tests. Runs after any test change.
   * A job on hold or cancelled keeps its status until a person releases it.
   */
  async syncStatus(tx: Tx, jobId: string): Promise<void> {
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, include: { samples: { include: { tests: { where: ACTIVE_TEST, select: { status: true, plannedAt: true } }, reports: { include: { revisions: { select: { status: true } } } } } } } });
    const rank = ['RECEIVED', 'PLANNED', 'IN_TESTING', 'REPORTING', 'COMPLETED'] as const;
    let lowest: number | null = null;
    for (const s of job.samples) {
      if (s.status === 'CANCELLED') continue;
      const tests = s.tests;
      let next: (typeof rank)[number] = 'RECEIVED';
      const planned = tests.length > 0 && tests.every((t) => t.plannedAt);
      if (planned) next = 'PLANNED';
      if (tests.some((t) => ['IN_PROGRESS', 'RESULTS_SUBMITTED', 'APPROVED'].includes(t.status))) next = 'IN_TESTING';
      if (tests.length > 0 && tests.every((t) => t.status === 'APPROVED')) next = 'REPORTING';
      if (next === 'REPORTING' && s.reports.some((r) => r.revisions.some((v) => v.status === 'ISSUED'))) next = 'COMPLETED';
      if (next !== s.status) {
        await tx.sample.update({ where: { id: s.id }, data: { status: next, version: { increment: 1 } } });
        await this.audit.status(tx, { entity: 'Sample', entityId: s.id, from: s.status, to: next, jobId });
      }
      const r = rank.indexOf(next);
      lowest = lowest === null ? r : Math.min(lowest, r);
    }
    if (job.status === 'ON_HOLD' || job.status === 'CANCELLED') return;
    if (lowest === null) return;
    const target = rank[lowest];
    if (target !== job.status) {
      assertSystemTransitionPath(job.status, target);
      await tx.job.update({ where: { id: jobId }, data: { status: target, version: { increment: 1 } } });
      await this.audit.status(tx, { entity: 'Job', entityId: jobId, from: job.status, to: target, jobId });
    }
  }

  // ---------------------------------------------------------------- acknowledgement & letters
  async sendAcknowledgement(jobId: string, dto: SendAckDto) {
    const job = await this.loadJob(jobId);
    const company = this.company.config;
    const row = await this.prisma.documentJob.create({
      data: {
        kind: 'job-acknowledgement',
        params: {
          jobId,
          email: {
            to: dto.to,
            cc: dto.cc ?? null,
            subject: `Samples received: ${job.jobNo} — ${company.companyName}`,
            bodyHtml: `<p>Dear ${esc(job.kindAttention ?? 'Sir/Madam')},</p><p>We have received your samples under job <strong>${esc(job.jobNo)}</strong>. The acknowledgement is attached.</p><p>Regards,<br>${esc(currentUser()?.name)}<br>${esc(company.companyName)}</p>`,
            template: 'acknowledgement',
            entity: 'Job',
            entityId: jobId,
          },
        },
        createdById: actorId(),
      },
    });
    await this.documents.queueExisting(row.id);
    await this.audit.record({ action: 'Job.acknowledgementQueued', entity: 'Job', entityId: jobId, after: { to: dto.to } });
    return { ok: true };
  }

  emails(jobId: string) {
    return this.prisma.emailLog.findMany({
      where: { entity: 'Job', entityId: jobId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, toAddress: true, ccAddress: true, subject: true, template: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
    });
  }

  /** Combines captured page images into one PDF, in the background. */
  async combineLetter(jobId: string, fileIds: string[]) {
    await this.loadJob(jobId);
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: fileIds }, entity: 'Job', entityId: jobId, deletedAt: null } });
    if (files.length !== fileIds.length) throw badRequest('One of those pages does not belong to this job', [{ field: 'fileIds', message: 'Not on this job' }]);
    if (files.some((f) => f.mimeType !== 'image/png' && f.mimeType !== 'image/jpeg')) throw badRequest('Only PNG and JPEG pages can be combined', [{ field: 'fileIds', message: 'Unsupported page type' }]);
    return this.documents.enqueue('letter-combine', { jobId, fileIds });
  }
}

/** The roll-up can move by more than one step, so each step on the way must be a valid edge. */
function assertSystemTransitionPath(from: string, to: string) {
  const order = ['RECEIVED', 'PLANNED', 'IN_TESTING', 'REPORTING', 'COMPLETED'];
  let i = order.indexOf(from);
  const end = order.indexOf(to);
  if (i < 0 || end < 0) throw conflict('Unexpected job status');
  while (i !== end) {
    const next = i < end ? i + 1 : i - 1;
    assertSystemTransition(JOB, order[i], order[next]);
    i = next;
  }
}
