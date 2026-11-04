import { createHash } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { actorId, can, currentUser, getContext } from '../../common/context.js';
import { AppError, badRequest, conflict, forbidden, notFound, rule } from '../../common/errors.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { assertSystemTransition, assertTransition, REPORT, TEST } from '../../common/workflow.js';
import type { CompanySnapshot } from '../../config/company.config.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { MailService } from '../../core/mail.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { StorageService } from '../../core/storage.service.js';
import { AuthService } from '../auth/auth.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PdfService } from '../pdf/pdf.service.js';
import { esc } from '../pdf/templates/base.js';
import { reportHtml, type ReportContent, type ReportFormat } from '../pdf/templates/report.js';
import { TestingService } from '../testing/testing.service.js';
import type { ReportCorrectDto, ReportIssueDto, ReportQuery, ReportRejectDto } from './reports.dto.js';

const sampleInclude = { sample: { select: { id: true, sampleNo: true, jobId: true, description: true, job: { select: { jobNo: true, contactEmail: true, customer: { select: { id: true, name: true, withholdReportUntilPaid: true, contacts: { where: { deletedAt: null, isPrimary: true }, select: { email: true } } } } } } } } } as const;
const fullInclude = { ...sampleInclude, revisions: { orderBy: { revisionNo: 'desc' }, include: { rejections: { orderBy: { at: 'desc' } }, signature: true } } } as const;
type Full = Prisma.ReportGetPayload<{ include: typeof fullInclude }>;
type Revision = Full['revisions'][number];

export const REPORT_PDF = 'report-pdf';

const hashContent = (content: unknown) => createHash('sha256').update(JSON.stringify(content)).digest('hex');

@Injectable()
export class ReportsService implements OnModuleInit {
  notify: ((tx: Tx, event: { type: 'REPORT_REJECTED' | 'REPORT_READY_FOR_REVIEW' | 'REPORT_READY_FOR_APPROVAL'; reportId: string; reason?: string }) => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly company: CompanyService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly jobs: JobsService,
    private readonly testing: TestingService,
    private readonly auth: AuthService,
  ) {}

  onModuleInit() {
    this.testing.onAllApproved = (tx, sampleId) => this.onSampleApproved(tx, sampleId);
    this.documents.register(REPORT_PDF, {
      authorize: () => {
        // A report names the customer, so both permissions are needed.
        if (!can('reports.view') || !can('customers.view')) throw forbidden();
      },
      run: (p) => this.renderPdf(String(p.revisionId)),
      after: async (file, p) => {
        if (!p.final) return;
        await this.prisma.reportRevision.update({ where: { id: String(p.revisionId) }, data: { pdfFileId: file.id, pdfSha256: file.sha256 } });
      },
    });
  }

  // ---------------------------------------------------------------- content
  private async buildContent(tx: Tx | PrismaService, sampleId: string, edits: Partial<ReportContent> = {}): Promise<ReportContent> {
    const s = await tx.sample.findUniqueOrThrow({
      where: { id: sampleId },
      include: {
        deviations: true,
        job: { include: { deviations: { where: { sampleId: null } }, customer: { include: { contacts: { where: { deletedAt: null } }, addresses: { where: { deletedAt: null } } } } } },
        tests: { where: { deletedAt: null, status: 'APPROVED' }, orderBy: { createdAt: 'asc' }, include: { results: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    const cust = s.job.customer;
    const contact = cust.contacts.find((c) => c.isPrimary) ?? cust.contacts[0];
    const addr = cust.addresses.find((a) => a.kind === 'REPORT') ?? cust.addresses.find((a) => a.kind === 'BILLING') ?? cust.addresses[0];
    const files = await tx.fileObject.findMany({ where: { entity: 'SampleTest', entityId: { in: s.tests.map((t) => t.id) }, category: 'result-image', deletedAt: null }, orderBy: { createdAt: 'asc' } });
    const specIds = [s.specificationId, s.dualSpecificationId].filter(Boolean) as string[];
    const specs = await tx.specification.findMany({ where: { id: { in: specIds } } });
    const starts = s.tests.map((t) => t.startedAt).filter((d): d is Date => !!d);
    const ends = s.tests.map((t) => t.approvedAt).filter((d): d is Date => !!d);
    return {
      sampleNo: s.sampleNo,
      jobNo: s.job.jobNo,
      customer: {
        name: cust.name,
        crn: cust.crn,
        address: s.job.reportIssueAddress ?? (addr ? [addr.line1, addr.line2, `${addr.city}${addr.pincode ? ` ${addr.pincode}` : ''}`, addr.stateName].filter(Boolean).join('\n') : null),
        kindAttention: s.job.kindAttention ?? contact?.name ?? null,
        email: s.job.contactEmail ?? contact?.email ?? null,
        phone: s.job.contactPhone ?? contact?.phone ?? null,
        gstin: cust.gstin,
        ...edits.customer,
      },
      customerReference: [s.job.letterRef, s.job.poNumber ? `PO ${s.job.poNumber}` : null].filter(Boolean).join(', ') || null,
      sampleDescription: s.description,
      sampleCondition: s.condition,
      sampleQuantity: s.quantity,
      sampleSize: s.size,
      bookingDate: s.job.receivedAt.toISOString(),
      testStartDate: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))).toISOString() : null,
      testCompletionDate: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))).toISOString() : null,
      sampleDrawnByLab: s.job.sampleDrawnByLab,
      specificationNames: specIds.map((id) => specs.find((x) => x.id === id)?.name ?? '').filter(Boolean),
      deviations: [...s.job.deviations, ...s.deviations].map((d) => ({ typeLabel: d.typeLabel, remark: d.remark })),
      tests: s.tests.map((t) => ({
        sampleTestId: t.id,
        testName: t.testName,
        methodName: t.methodName,
        conductedByName: t.conductedByName,
        remarks: t.remarks,
        observations: t.observations,
        parameters: t.results.map((r) => ({
          name: r.name,
          value: r.numericValue !== null ? new Prisma.Decimal(r.numericValue).toFixed(r.decimals) : r.textValue,
          unit: r.unit,
          limits: (r.limits as ReportContent['tests'][number]['parameters'][number]['limits'] | null) ?? [],
          passPrimary: r.passPrimary,
          passDual: r.passDual,
          accredited: r.accredited,
        })),
        images: files.filter((f) => f.entityId === t.id).map((f) => ({ fileId: f.id, widthMm: f.printWidthMm ?? 80, heightMm: f.printHeightMm ?? 60, caption: f.caption })),
      })),
      reportRemarks: edits.reportRemarks ?? null,
      ...(edits.sampleDescription ? { sampleDescription: edits.sampleDescription } : {}),
      ...(edits.customerReference !== undefined ? { customerReference: edits.customerReference } : {}),
    };
  }

  private async reportFormat(tx: Tx | PrismaService): Promise<ReportFormat> {
    const t = tx as Tx;
    return {
      formatNo: await this.settings.get('report.formatNo', t),
      issueNo: await this.settings.get('report.issueNo', t),
      issueDate: await this.settings.get('report.issueDate', t),
      revisionNo: await this.settings.get('report.revisionNo', t),
      revisionDate: await this.settings.get('report.revisionDate', t),
      samplingStatement: await this.settings.get('report.samplingStatement', t),
    };
  }

  /** Auto-draft: once all active tests on a sample are approved. A retest refreshes the open draft. */
  private async onSampleApproved(tx: Tx, sampleId: string) {
    const existing = await tx.report.findFirst({ where: { sampleId }, include: { revisions: { orderBy: { revisionNo: 'desc' }, take: 1 } } });
    const isDemo = (await tx.sample.findUniqueOrThrow({ where: { id: sampleId } })).isDemo;
    const sample = await tx.sample.findUniqueOrThrow({ where: { id: sampleId }, select: { jobId: true } });
    if (!existing) {
      const reportNo = await this.numbering.next(tx, 'REPORT');
      const content = await this.buildContent(tx, sampleId);
      const report = await tx.report.create({
        data: { reportNo, sampleId, isDemo, revisions: { create: { revisionNo: 0, content: content as unknown as Prisma.InputJsonValue, companySnapshot: this.company.snapshot() as unknown as Prisma.InputJsonValue, createdById: actorId() } } },
      });
      await this.audit.status(tx, { entity: 'Report', entityId: report.id, from: null, to: 'DRAFT', jobId: sample.jobId });
      await this.notify?.(tx, { type: 'REPORT_READY_FOR_REVIEW', reportId: report.id });
      return;
    }
    const latest = existing.revisions[0];
    if (latest.status === 'DRAFT') {
      const old = latest.content as unknown as ReportContent;
      const content = await this.buildContent(tx, sampleId, { reportRemarks: old.reportRemarks, sampleDescription: old.sampleDescription, customerReference: old.customerReference, customer: old.customer });
      await tx.reportRevision.update({ where: { id: latest.id }, data: { content: content as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      await this.audit.record({ action: 'Report.refreshed', entity: 'Report', entityId: existing.id, after: { revisionNo: latest.revisionNo } }, tx);
    }
  }

  // ---------------------------------------------------------------- rendering
  private async withImages(content: ReportContent): Promise<ReportContent> {
    return {
      ...content,
      tests: await Promise.all(
        content.tests.map(async (t) => ({
          ...t,
          images: await Promise.all(
            t.images.map(async (img) => {
              try {
                const f = await this.storage.read(img.fileId);
                return f.mimeType.startsWith('image/') ? { ...img, dataUri: `data:${f.mimeType};base64,${f.buffer.toString('base64')}` } : img;
              } catch {
                return img;
              }
            }),
          ),
        })),
      ),
    };
  }

  /** Everything printed comes from the revision's stored snapshot, never from live master or env values. */
  private async renderInput(revisionId: string) {
    const rev = await this.prisma.reportRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { report: true, signature: true } });
    const company = rev.companySnapshot as unknown as CompanySnapshot;
    const replaced = rev.replacesRevisionId ? await this.prisma.reportRevision.findUnique({ where: { id: rev.replacesRevisionId } }) : null;
    const stored = rev.content as unknown as ReportContent & { format?: ReportFormat };
    let imageDataUri: string | null = null;
    if (rev.signature?.signatureFileId) {
      try {
        const f = await this.storage.read(rev.signature.signatureFileId);
        imageDataUri = `data:${f.mimeType};base64,${f.buffer.toString('base64')}`;
      } catch {
        imageDataUri = null;
      }
    }
    const frozen = ['APPROVED', 'ISSUED', 'SUPERSEDED'].includes(rev.status);
    const terms = frozen ? rev.termsSnapshot : ((await this.prisma.termsVersion.findFirst({ where: { kind: 'REPORT' }, orderBy: { versionNo: 'desc' } }))?.body ?? null);
    return {
      reportNo: rev.report.reportNo,
      revisionNo: rev.revisionNo,
      replacesLabel: replaced ? `${rev.report.reportNo} revision ${replaced.revisionNo}` : null,
      revisionReason: rev.revisionReason,
      ulrNumber: rev.ulrNumber,
      issueDate: rev.issuedAt ?? rev.approvedAt,
      content: await this.withImages(stored),
      format: stored.format ?? (await this.reportFormat(this.prisma)),
      company,
      terms,
      reviewedByName: rev.reviewedByName,
      draft: !frozen,
      signature: rev.signature ? { name: rev.signature.name, designation: rev.signature.designation, signedAt: rev.signature.signedAt, contentSha256: rev.signature.contentSha256, imageDataUri } : null,
    };
  }

  private async renderPdf(revisionId: string) {
    const input = await this.renderInput(revisionId);
    const buffer = await this.pdf.render(reportHtml(input), { company: input.company, reportVerification: true });
    const rev = await this.prisma.reportRevision.findUniqueOrThrow({ where: { id: revisionId }, select: { reportId: true } });
    return { buffer, filename: `Test Report ${input.reportNo} R${input.revisionNo}.pdf`.replace(/[/\\]/g, '-'), mimeType: 'application/pdf', entity: 'Report', entityId: rev.reportId };
  }

  /** Live preview during review; the same template as the PDF, returned as a document string. */
  async preview(id: string, revisionNo?: number) {
    const r = await this.load(id);
    const rev = revisionNo === undefined ? r.revisions[0] : r.revisions.find((x) => x.revisionNo === revisionNo);
    if (!rev) throw notFound('Revision');
    return { html: reportHtml(await this.renderInput(rev.id)) };
  }

  // ---------------------------------------------------------------- reads
  private async load(id: string, tx: Tx | PrismaService = this.prisma): Promise<Full> {
    const r = await tx.report.findUnique({ where: { id }, include: fullInclude });
    if (!r) throw notFound('Report');
    return r;
  }

  async list(q: ReportQuery) {
    const identity = can('customers.view');
    const revisionFilter: Prisma.ReportRevisionWhereInput = q.status ? { status: q.status } : {};
    const where: Prisma.ReportWhereInput = {
      ...(q.status ? { revisions: { some: revisionFilter } } : {}),
      ...(q.jobId ? { sample: { jobId: q.jobId } } : {}),
      ...(q.q ? { OR: [{ reportNo: { contains: q.q, mode: 'insensitive' } }, { sample: { sampleNo: { contains: q.q, mode: 'insensitive' } } }, ...(identity ? [{ sample: { job: { customer: { name: { contains: q.q, mode: 'insensitive' as const } } } } }] : [])] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({ where, include: { ...sampleInclude, revisions: { orderBy: { revisionNo: 'desc' }, take: 1 } }, orderBy: orderBy(q, ['reportNo', 'createdAt'], 'createdAt'), ...skipTake(q) }),
      this.prisma.report.count({ where }),
    ]);
    return toPage(
      rows.map((r) => {
        const v = r.revisions[0];
        return { id: r.id, reportNo: r.reportNo, revisionId: v.id, revisionNo: v.revisionNo, status: v.status, sampleId: r.sample.id, sampleNo: r.sample.sampleNo, jobId: r.sample.jobId, jobNo: r.sample.job.jobNo, customerName: identity ? r.sample.job.customer.name : null, ulrNumber: v.ulrNumber, createdAt: r.createdAt, issuedAt: v.issuedAt, version: v.version };
      }),
      total,
      q,
    );
  }

  private async withheld(tx: Tx | PrismaService, r: Full) {
    if (!r.sample.job.customer.withholdReportUntilPaid) return false;
    const invoices = await tx.invoice.findMany({ where: { status: { notIn: ['CANCELLED', 'DRAFT'] }, lines: { some: { jobId: r.sample.jobId } } }, select: { status: true } });
    return invoices.length === 0 || invoices.some((i) => i.status !== 'PAID');
  }

  async get(id: string) {
    const r = await this.load(id);
    const identity = can('customers.view');
    const me = actorId();
    const tests = await this.prisma.sampleTest.findMany({ where: { sampleId: r.sample.id, deletedAt: null, status: { not: 'CANCELLED' } }, select: { id: true, testName: true, status: true }, orderBy: { createdAt: 'asc' } });
    const current = r.revisions[0];
    const content = current.content as unknown as ReportContent;
    return {
      id: r.id, reportNo: r.reportNo, sampleId: r.sample.id, sampleNo: r.sample.sampleNo, jobId: r.sample.jobId, jobNo: r.sample.job.jobNo,
      customerName: identity ? r.sample.job.customer.name : null,
      customerEmail: identity ? (r.sample.job.contactEmail ?? r.sample.job.customer.contacts[0]?.email ?? null) : null,
      currentRevisionNo: r.currentRevisionNo,
      revisions: r.revisions.map((v) => this.revisionDto(v)),
      tests: tests.map((t) => ({ sampleTestId: t.id, testName: t.testName, status: t.status })),
      canReview: can('reports.review') && current.status !== 'APPROVED',
      canApprove: can('reports.approve') && current.reviewedById !== me,
      withheld: await this.withheld(this.prisma, r),
      reportRemarks: content.reportRemarks, sampleDescription: content.sampleDescription, customerReference: content.customerReference, kindAttention: content.customer.kindAttention,
    };
  }

  private revisionDto(v: Revision) {
    return {
      id: v.id, revisionNo: v.revisionNo, status: v.status, revisionReason: v.revisionReason, ulrNumber: v.ulrNumber, reviewedByName: v.reviewedByName, reviewedAt: v.reviewedAt, approvedByName: v.approvedByName, approvedAt: v.approvedAt, issuedAt: v.issuedAt, supersededAt: v.supersededAt,
      pdfReady: !!v.pdfFileId, pdfSha256: v.pdfSha256, version: v.version,
      rejections: v.rejections.map((x) => ({ id: x.id, stage: x.stage, action: x.action, reason: x.reason, byName: x.byName, at: x.at, sampleTestIds: x.sampleTestIds as string[] | null })),
      signature: v.signature ? { name: v.signature.name, designation: v.signature.designation, signedAt: v.signature.signedAt, contentSha256: v.signature.contentSha256 } : null,
    };
  }

  // ---------------------------------------------------------------- workflow
  private current(r: Full): Revision {
    return r.revisions[0];
  }

  private async move(tx: Tx, rev: Revision, version: number, to: 'IN_REVIEW' | 'PENDING_APPROVAL' | 'DRAFT' | 'APPROVED' | 'ISSUED', data: Prisma.ReportRevisionUncheckedUpdateManyInput = {}) {
    const { count } = await tx.reportRevision.updateMany({ where: { id: rev.id, version }, data: { ...data, status: to, version: { increment: 1 } } });
    if (count !== 1) throw conflict();
  }

  async submitForReview(id: string, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const rev = this.current(r);
      assertTransition(REPORT, rev.status, 'IN_REVIEW');
      const open = await tx.sampleTest.count({ where: { sampleId: r.sample.id, deletedAt: null, status: { notIn: ['APPROVED', 'CANCELLED'] } } });
      if (open) throw rule('TESTS_OPEN', 'Some tests are still being re-tested');
      await this.move(tx, rev, version, 'IN_REVIEW');
      await this.audit.status(tx, { entity: 'Report', entityId: id, from: rev.status, to: 'IN_REVIEW', jobId: r.sample.jobId });
    });
    return this.get(id);
  }

  async passReview(id: string, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const rev = this.current(r);
      assertTransition(REPORT, rev.status, 'PENDING_APPROVAL');
      await this.move(tx, rev, version, 'PENDING_APPROVAL', { reviewedById: actorId(), reviewedByName: currentUser()!.name, reviewedAt: new Date() });
      await this.audit.status(tx, { entity: 'Report', entityId: id, from: rev.status, to: 'PENDING_APPROVAL', jobId: r.sample.jobId });
      await this.notify?.(tx, { type: 'REPORT_READY_FOR_APPROVAL', reportId: id });
    });
    return this.get(id);
  }

  /** At review or approval: correct the report, or send named tests back for re-testing. All history stays. */
  async reject(id: string, dto: ReportRejectDto) {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const rev = this.current(r);
      assertTransition(REPORT, rev.status, 'DRAFT', dto.reason);
      if (dto.action === 'RETEST' && !dto.sampleTestIds?.length) throw badRequest('Choose the tests to send back', [{ field: 'sampleTestIds', message: 'Choose at least one test' }]);
      await tx.reportRejection.create({ data: { revisionId: rev.id, stage: rev.status, action: dto.action, reason: dto.reason, sampleTestIds: dto.action === 'RETEST' ? dto.sampleTestIds : undefined, byId: actorId(), byName: currentUser()!.name } });
      await this.move(tx, rev, dto.version, 'DRAFT', { reviewedById: null, reviewedByName: null, reviewedAt: null });
      await this.audit.status(tx, { entity: 'Report', entityId: id, from: rev.status, to: 'DRAFT', reason: dto.reason, jobId: r.sample.jobId, meta: { action: dto.action } });
      if (dto.action === 'RETEST') {
        for (const testId of dto.sampleTestIds!) {
          const t = await tx.sampleTest.findFirst({ where: { id: testId, sampleId: r.sample.id, deletedAt: null } });
          if (!t) throw badRequest('That test is not on this report', [{ field: 'sampleTestIds', message: 'Not on this report' }]);
          assertTransition(TEST, t.status, 'IN_PROGRESS', dto.reason);
          await tx.sampleTest.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS', rejectionReason: dto.reason, approvedAt: null, approvedById: null, submittedAt: null, version: { increment: 1 } } });
          await this.audit.status(tx, { entity: 'SampleTest', entityId: t.id, from: t.status, to: 'IN_PROGRESS', reason: dto.reason, jobId: r.sample.jobId, meta: { reportRetest: true } });
        }
        await this.jobs.syncStatus(tx, r.sample.jobId);
      }
      await this.notify?.(tx, { type: 'REPORT_REJECTED', reportId: id, reason: dto.reason });
    });
    return this.get(id);
  }

  /** Corrections apply to a draft only. An approved or issued report is never edited in place. */
  async correct(id: string, dto: ReportCorrectDto) {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const rev = this.current(r);
      if (rev.status !== 'DRAFT') throw rule('LOCKED', 'Only a draft can be corrected');
      if (!can('reports.review') && !can('reports.approve')) throw forbidden();
      const before = rev.content as unknown as ReportContent;
      const content: ReportContent = {
        ...before,
        ...(dto.reportRemarks !== undefined ? { reportRemarks: dto.reportRemarks } : {}),
        ...(dto.sampleDescription !== undefined ? { sampleDescription: dto.sampleDescription } : {}),
        ...(dto.customerReference !== undefined ? { customerReference: dto.customerReference } : {}),
        customer: { ...before.customer, ...(dto.kindAttention !== undefined ? { kindAttention: dto.kindAttention } : {}) },
      };
      const { count } = await tx.reportRevision.updateMany({ where: { id: rev.id, version: dto.version }, data: { content: content as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      if (count !== 1) throw conflict();
      await this.audit.record({ action: 'Report.corrected', entity: 'Report', entityId: id, before: { reportRemarks: before.reportRemarks, sampleDescription: before.sampleDescription }, after: dto }, tx);
    });
    return this.get(id);
  }

  /**
   * Final approval and electronic signature. The content, company details, terms and format are
   * frozen here; the PDF then renders in the background from that snapshot and its hash is stored.
   */
  async approve(id: string, version: number, password: string) {
    const me = currentUser()!;
    if (!can('reports.approve')) throw forbidden();
    if (!(await this.auth.confirmPassword(me.id, password))) throw new AppError('INVALID_PASSWORD', 403, 'Incorrect password', [{ field: 'password', message: 'Incorrect password' }]);
    const revisionId = await this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const rev = this.current(r);
      assertTransition(REPORT, rev.status, 'APPROVED');
      if (rev.reviewedById === me.id && !(await this.settings.get('controls.allowSameReviewerSignatory', tx))) {
        throw new AppError('SAME_REVIEWER', 403, 'The reviewer and signatory of a report must be different people');
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: me.id } });
      const live = rev.content as unknown as ReportContent;
      const content = { ...live, format: await this.reportFormat(tx) };
      const contentSha256 = hashContent(content);
      const companyConfig = this.company.config;
      const anyInScope = live.tests.some((t) => t.parameters.some((p) => p.accredited));
      // ULR only when the report is NABL-applicable and NABL mode is on. The format is the company's own.
      const ulrNumber = rev.ulrNumber ?? (companyConfig.accreditation.nablMode && anyInScope ? await this.numbering.next(tx, 'ULR', new Date(), companyConfig.accreditation.ulrFormat!) : null);
      const terms = await tx.termsVersion.findFirst({ where: { kind: 'REPORT' }, orderBy: { versionNo: 'desc' } });
      await this.move(tx, rev, version, 'APPROVED', {
        approvedById: me.id,
        approvedByName: me.name,
        approvedAt: new Date(),
        ulrNumber,
        content: content as unknown as Prisma.InputJsonValue,
        companySnapshot: this.company.snapshot() as unknown as Prisma.InputJsonValue,
        termsSnapshot: terms?.body ?? null,
      });
      await tx.reportSignature.create({ data: { revisionId: rev.id, userId: me.id, name: user.name, designation: user.designation, signatureFileId: user.signatureFileId, ip: getContext()?.ip, contentSha256 } });
      await this.audit.status(tx, { entity: 'Report', entityId: id, from: rev.status, to: 'APPROVED', jobId: r.sample.jobId, meta: { contentSha256, ulrNumber } });
      return rev.id;
    });
    const job = await this.prisma.documentJob.create({ data: { kind: REPORT_PDF, params: { revisionId, final: true }, createdById: me.id } });
    await this.documents.queueExisting(job.id);
    return this.get(id);
  }

  async issue(id: string, dto: ReportIssueDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const rev = this.current(r);
      assertTransition(REPORT, rev.status, 'ISSUED');
      if (!rev.pdfFileId) throw rule('PDF_PENDING', 'The final PDF is still being prepared. Try again in a moment.');
      if (await this.withheld(tx, r)) throw rule('WITHHELD', 'This customer has report release withheld until payment is received');
      await this.move(tx, rev, dto.version, 'ISSUED', { issuedAt: new Date(), issuedById: actorId() });
      await tx.report.update({ where: { id }, data: { currentRevisionNo: rev.revisionNo } });
      await this.audit.status(tx, { entity: 'Report', entityId: id, from: rev.status, to: 'ISSUED', jobId: r.sample.jobId });
      if (rev.replacesRevisionId) {
        assertSystemTransition(REPORT, 'ISSUED', 'SUPERSEDED');
        await tx.reportRevision.update({ where: { id: rev.replacesRevisionId }, data: { status: 'SUPERSEDED', supersededAt: new Date(), version: { increment: 1 } } });
        await this.audit.status(tx, { entity: 'Report', entityId: id, from: 'ISSUED', to: 'SUPERSEDED', jobId: r.sample.jobId, reason: rev.revisionReason, meta: { replacedRevisionId: rev.replacesRevisionId } });
      }
      await this.jobs.syncStatus(tx, r.sample.jobId);
      return { revisionId: rev.id };
    });
    if (dto.emailTo) await this.emailReport(id, dto.emailTo, dto.emailCc ?? null, result.revisionId);
    return this.get(id);
  }

  async emailReport(id: string, to: string, cc: string | null, revisionId?: string) {
    const r = await this.load(id);
    const rev = revisionId ? r.revisions.find((v) => v.id === revisionId)! : (r.revisions.find((v) => v.status === 'ISSUED') ?? null);
    if (!rev || !rev.pdfFileId || !['ISSUED'].includes(rev.status)) throw rule('NOT_ISSUED', 'Only an issued report can be emailed');
    const company = rev.companySnapshot as unknown as CompanySnapshot;
    await this.mail.enqueue({
      to,
      cc,
      subject: `Test report ${r.reportNo}${rev.revisionNo ? ` revision ${rev.revisionNo}` : ''} — ${company.companyName}`,
      template: 'report',
      entity: 'Report',
      entityId: id,
      attachmentFileIds: [rev.pdfFileId],
      bodyHtml: `<p>Dear Sir/Madam,</p><p>Please find attached test report <strong>${esc(r.reportNo)}</strong> for sample ${esc(r.sample.sampleNo)}.</p>${rev.revisionNo ? `<p>This revision replaces the earlier version. Reason: ${esc(rev.revisionReason)}</p>` : ''}<p>To verify this report, write to ${esc(company.reportVerificationEmail)}.</p>`,
    });
    await this.audit.record({ action: 'Report.emailed', entity: 'Report', entityId: id, after: { to, revisionNo: rev.revisionNo } });
    return { ok: true };
  }

  emails(id: string) {
    return this.prisma.emailLog.findMany({
      where: { entity: 'Report', entityId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, toAddress: true, ccAddress: true, subject: true, template: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
    });
  }

  /** A correction: a new revision with a mandatory reason, through review and approval again. */
  async revise(id: string, reason: string) {
    if (!can('reports.revise')) throw forbidden();
    if (!reason.trim()) throw badRequest('A reason is required', [{ field: 'reason', message: 'A reason is required' }]);
    await this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const rev = this.current(r);
      if (rev.status !== 'ISSUED') throw rule('NOT_ISSUED', 'Only an issued report can be revised');
      const old = rev.content as unknown as ReportContent;
      const content = await this.buildContent(tx, r.sample.id, { reportRemarks: old.reportRemarks, sampleDescription: old.sampleDescription, customerReference: old.customerReference, customer: old.customer });
      const next = await tx.reportRevision.create({
        data: { reportId: id, revisionNo: rev.revisionNo + 1, revisionReason: reason, replacesRevisionId: rev.id, ulrNumber: rev.ulrNumber, content: content as unknown as Prisma.InputJsonValue, companySnapshot: this.company.snapshot() as unknown as Prisma.InputJsonValue, createdById: actorId() },
      });
      await this.audit.status(tx, { entity: 'Report', entityId: id, from: 'ISSUED', to: 'DRAFT', reason, jobId: r.sample.jobId, meta: { revisionNo: next.revisionNo } });
    });
    return this.get(id);
  }

  /** Any revision stays downloadable, including superseded ones. */
  async pdfUrl(revisionId: string) {
    const rev = await this.prisma.reportRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw notFound('Revision');
    if (!rev.pdfFileId) throw rule('PDF_PENDING', 'The final PDF is not available yet');
    const s = await this.storage.signedUrl(rev.pdfFileId);
    return { url: s.url, filename: s.originalName };
  }

  history(id: string) {
    return this.prisma.auditLog.findMany({ where: { entity: 'Report', entityId: id }, orderBy: { at: 'desc' }, take: 200 }).then((rows) => rows.map((r) => ({ id: r.id.toString(), at: r.at, userName: r.userName, action: r.action, before: r.before, after: r.after, reason: r.reason })));
  }
}

