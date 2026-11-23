import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import QRCode from 'qrcode';
import { actorId, can, currentUser, getContext } from '../../common/context.js';
import { AppError, badRequest, conflict, forbidden, notFound, rule } from '../../common/errors.js';
import { hideEmailIdentity, hideIdentity } from '../../common/identity.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { assertSystemTransition, assertTransition, REPORT, TEST } from '../../common/workflow.js';
import type { CompanySnapshot } from '../../config/company.config.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { EmailTemplateService } from '../../core/email-template.service.js';
import { MailService } from '../../core/mail.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { StorageService } from '../../core/storage.service.js';
import { AuthService } from '../auth/auth.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PdfService } from '../pdf/pdf.service.js';
import { reportAnnexes, reportHtml, type ReportContent, type ReportFormat, type ReportPhoto } from '../pdf/templates/report.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { TestingService } from '../testing/testing.service.js';
import type { ReportCorrectDto, ReportIssueDto, ReportQuery, ReportRejectDto, ReportVerificationDto } from './reports.dto.js';

const sampleInclude = {
  sample: {
    select: {
      id: true,
      sampleNo: true,
      jobId: true,
      description: true,
      job: {
        select: {
          jobNo: true,
          contactEmail: true,
          customer: { select: { id: true, name: true, withholdReportUntilPaid: true, contacts: { where: { deletedAt: null, isPrimary: true }, select: { email: true } } } },
        },
      },
    },
  },
} as const;
const fullInclude = { ...sampleInclude, revisions: { orderBy: { revisionNo: 'desc' }, include: { rejections: { orderBy: { at: 'desc' } }, signature: true } } } as const;
type Full = Prisma.ReportGetPayload<{ include: typeof fullInclude }>;
type Revision = Full['revisions'][number];

export const REPORT_PDF = 'report-pdf';

const hashContent = (content: unknown) => createHash('sha256').update(JSON.stringify(content)).digest('hex');

/** 144 random bits, URL-safe: printed as a QR, so it must not be guessable from the report number. */
export const newVerificationCode = () => randomBytes(18).toString('base64url');

@Injectable()
export class ReportsService implements OnModuleInit {
  notify: ((tx: Tx, event: { type: 'REPORT_REJECTED' | 'REPORT_READY_FOR_REVIEW' | 'REPORT_READY_FOR_APPROVAL'; reportId: string; reason?: string }) => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly company: CompanyService,
    private readonly templates: EmailTemplateService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly jobs: JobsService,
    private readonly testing: TestingService,
    private readonly auth: AuthService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit() {
    this.testing.onAllApproved = (tx, sampleId) => this.onSampleApproved(tx, sampleId);
    // A signed report whose final PDF failed (worker down, Redis lost the job) would otherwise never be issuable.
    this.scheduler.register({ name: 'report-pdf-sweep', pattern: '*/10 * * * *', run: () => this.sweepMissingPdfs() });
    this.documents.register(REPORT_PDF, {
      // Queued only by approve(): its `final` run replaces the signed report's official file and fingerprint.
      internal: true,
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
        tests: {
          where: { deletedAt: null, status: 'APPROVED' },
          orderBy: { createdAt: 'asc' },
          include: { results: { orderBy: { sortOrder: 'asc' } }, instrument: { select: { code: true, name: true } } },
        },
      },
    });
    const cust = s.job.customer;
    const contact = cust.contacts.find((c) => c.isPrimary) ?? cust.contacts[0];
    const addr = cust.addresses.find((a) => a.kind === 'REPORT') ?? cust.addresses.find((a) => a.kind === 'BILLING') ?? cust.addresses[0];
    const files = await tx.fileObject.findMany({
      // Only what the analyst left ticked "Print on report"; raw data and worksheets never print.
      where: { entity: 'SampleTest', entityId: { in: s.tests.map((t) => t.id) }, category: { in: ['result-image', 'instrument-report'] }, printOnReport: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
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
        // Working values (dimensions, loads, individual readings) stay on the test record, off the report.
        parameters: t.results
          .filter((r) => r.showOnReport)
          .map((r) => ({
            name: r.name,
            value: r.numericValue !== null ? `${r.qualifier ? `${r.qualifier} ` : ''}${new Prisma.Decimal(r.numericValue).toFixed(r.decimals)}` : r.textValue,
            unit: r.unit,
            limits: (r.limits as ReportContent['tests'][number]['parameters'][number]['limits'] | null) ?? [],
            passPrimary: r.passPrimary,
            passDual: r.passDual,
            accredited: r.accredited,
          })),
        instrument: t.instrument ? `${t.instrument.code} ${t.instrument.name}` : null,
        images: files
          .filter((f) => f.entityId === t.id && f.category === 'result-image')
          .map((f) => ({ fileId: f.id, widthMm: f.printWidthMm ?? 80, heightMm: f.printHeightMm ?? 60, caption: f.caption, recordedAt: f.createdAt.toISOString() })),
        annexes: files
          .filter((f) => f.entityId === t.id && f.category === 'instrument-report')
          .map((f) => ({ fileId: f.id, title: f.caption || f.originalName.replace(/\.pdf$/i, ''), pages: f.pageCount ?? 1, sha256: f.sha256, recordedAt: f.createdAt.toISOString() })),
      })),
      reportRemarks: edits.reportRemarks ?? null,
      samplePhotos: edits.samplePhotos ?? [],
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
        data: {
          reportNo,
          sampleId,
          isDemo,
          revisions: {
            create: { revisionNo: 0, content: content as unknown as Prisma.InputJsonValue, companySnapshot: this.company.snapshot() as unknown as Prisma.InputJsonValue, createdById: actorId() },
          },
        },
      });
      await this.audit.status(tx, { entity: 'Report', entityId: report.id, from: null, to: 'DRAFT', jobId: sample.jobId });
      await this.notify?.(tx, { type: 'REPORT_READY_FOR_REVIEW', reportId: report.id });
      return;
    }
    const latest = existing.revisions[0];
    if (latest.status === 'DRAFT') {
      const old = latest.content as unknown as ReportContent;
      const content = await this.buildContent(tx, sampleId, {
        reportRemarks: old.reportRemarks,
        sampleDescription: old.sampleDescription,
        customerReference: old.customerReference,
        customer: old.customer,
        samplePhotos: old.samplePhotos,
      });
      await tx.reportRevision.update({ where: { id: latest.id }, data: { content: content as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      await this.audit.record({ action: 'Report.refreshed', entity: 'Report', entityId: existing.id, after: { revisionNo: latest.revisionNo } }, tx);
    }
  }

  // ---------------------------------------------------------------- rendering
  private async withImages(content: ReportContent): Promise<ReportContent> {
    const inline = async <T extends { fileId: string }>(img: T): Promise<T & { dataUri?: string | null }> => {
      try {
        const f = await this.storage.read(img.fileId);
        return f.mimeType.startsWith('image/') ? { ...img, dataUri: `data:${f.mimeType};base64,${f.buffer.toString('base64')}` } : img;
      } catch {
        return img;
      }
    };
    return {
      ...content,
      samplePhotos: await Promise.all((content.samplePhotos ?? []).map(inline)),
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

  /** A signed revision prints only from what was stored when it was signed, never from live masters or settings. */
  private async renderInput(revisionId: string) {
    const rev = await this.prisma.reportRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { report: true, signature: true } });
    // Until it is signed a report shows the lab as it is now; approval freezes the lab's details onto the revision.
    const signed = ['APPROVED', 'ISSUED', 'SUPERSEDED'].includes(rev.status);
    const company = signed ? (rev.companySnapshot as unknown as CompanySnapshot) : this.company.snapshot();
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
    const verifyUrl = frozen && rev.verificationCode ? this.verificationUrl(rev.verificationCode) : null;
    const verification = verifyUrl ? { url: verifyUrl, qrDataUri: await QRCode.toDataURL(verifyUrl, { margin: 0, width: 240, errorCorrectionLevel: 'M' }) } : null;
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
      signature: rev.signature
        ? { name: rev.signature.name, designation: rev.signature.designation, signedAt: rev.signature.signedAt, contentSha256: rev.signature.contentSha256, imageDataUri }
        : null,
      verification,
    };
  }

  verificationUrl(code: string) {
    return `${this.infra.frontendOrigin.replace(/\/+$/, '')}/verify/${code}`;
  }

  /**
   * Public, no sign-in: anyone holding the printed code can confirm the report is genuine and current.
   * Allow-list by construction: lab name, report and sample identity, the customer's name, results and
   * approval. No addresses, contacts, prices or company tax and bank details.
   */
  async verify(code: string): Promise<ReportVerificationDto> {
    const rev = await this.prisma.reportRevision.findUnique({
      where: { verificationCode: code },
      include: { report: { include: { revisions: { select: { revisionNo: true, status: true } } } }, signature: true },
    });
    if (!rev || !['APPROVED', 'ISSUED', 'SUPERSEDED'].includes(rev.status)) throw notFound('Report');
    const content = rev.content as unknown as ReportContent;
    const company = rev.companySnapshot as unknown as CompanySnapshot;
    const newer = rev.report.revisions.filter((v) => v.revisionNo > rev.revisionNo && v.status === 'ISSUED').sort((a, b) => b.revisionNo - a.revisionNo)[0];
    return {
      status: rev.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'VALID',
      laboratoryName: company.legalName,
      reportNo: rev.report.reportNo,
      revisionNo: rev.revisionNo,
      ulrNumber: rev.ulrNumber,
      issuedAt: rev.issuedAt,
      approvedAt: rev.approvedAt!,
      approvedByName: rev.signature?.name ?? rev.approvedByName ?? '',
      customerName: content.customer.name,
      sampleNo: content.sampleNo,
      sampleDescription: content.sampleDescription,
      contentSha256: rev.signature?.contentSha256 ?? null,
      pdfSha256: rev.pdfSha256,
      supersededAt: rev.supersededAt,
      replacedByRevisionNo: rev.status === 'SUPERSEDED' ? (newer?.revisionNo ?? null) : null,
      tests: content.tests.map((t) => ({ testName: t.testName, methodName: t.methodName, parameters: t.parameters.map((p) => ({ name: p.name, value: p.value, unit: p.unit })) })),
    };
  }

  private async renderPdf(revisionId: string) {
    const input = await this.renderInput(revisionId);
    const html = reportHtml(input);
    const annexes = reportAnnexes(input.content);
    let buffer = await this.pdf.render(html, { company: input.company, reportVerification: true });
    if (annexes.length) {
      // The body's own footer must count the annexure pages too: measure the body, then render it with the full total.
      const files = await Promise.all(annexes.map((a) => this.storage.read(a.fileId)));
      // The file must be the one fingerprinted when the report was signed.
      files.forEach((f, i) => {
        if (createHash('sha256').update(f.buffer).digest('hex') !== annexes[i].sha256) throw new AppError('ANNEX_CHANGED', 409, `Annexure ${annexes[i].letter} is not the file that was approved.`);
      });
      const totalPages = (await this.pdf.pageCount(buffer)) + annexes.reduce((s, a) => s + a.pages, 0);
      buffer = await this.pdf.render(html, { company: input.company, reportVerification: true, totalPages });
      buffer = await this.pdf.appendAnnexes(
        buffer,
        annexes.map((a, i) => ({ letter: a.letter, testName: a.testName, title: a.title, bytes: files[i].buffer })),
        { reportNo: input.reportNo, legalName: input.company.legalName },
      );
    }
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
    if (q.customerId && !identity) throw forbidden();
    const where: Prisma.ReportWhereInput = {
      ...(q.status ? { latestStatus: q.status } : {}),
      ...(q.jobId ? { sample: { jobId: q.jobId } } : {}),
      ...(q.customerId ? { sample: { ...(q.jobId ? { jobId: q.jobId } : {}), job: { customerId: q.customerId } } } : {}),
      ...(q.q
        ? {
            OR: [
              { reportNo: { contains: q.q, mode: 'insensitive' } },
              { sample: { sampleNo: { contains: q.q, mode: 'insensitive' } } },
              ...(identity ? [{ sample: { job: { customer: { name: { contains: q.q, mode: 'insensitive' as const } } } } }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: { ...sampleInclude, revisions: { orderBy: { revisionNo: 'desc' }, take: 1 } },
        orderBy: orderBy(q, ['reportNo', 'createdAt'], 'createdAt'),
        ...skipTake(q),
      }),
      this.prisma.report.count({ where }),
    ]);
    return toPage(
      rows.map((r) => {
        const v = r.revisions[0];
        return {
          id: r.id,
          reportNo: r.reportNo,
          revisionId: v.id,
          revisionNo: v.revisionNo,
          status: v.status,
          sampleId: r.sample.id,
          sampleNo: r.sample.sampleNo,
          jobId: r.sample.jobId,
          jobNo: r.sample.job.jobNo,
          customerName: identity ? r.sample.job.customer.name : null,
          ulrNumber: v.ulrNumber,
          createdAt: r.createdAt,
          issuedAt: v.issuedAt,
          version: v.version,
        };
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
    const tests = await this.prisma.sampleTest.findMany({
      where: { sampleId: r.sample.id, deletedAt: null, status: { not: 'CANCELLED' } },
      select: { id: true, testName: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    const current = r.revisions[0];
    const content = current.content as unknown as ReportContent;
    return {
      id: r.id,
      reportNo: r.reportNo,
      sampleId: r.sample.id,
      sampleNo: r.sample.sampleNo,
      jobId: r.sample.jobId,
      jobNo: r.sample.job.jobNo,
      customerName: identity ? r.sample.job.customer.name : null,
      customerEmail: identity ? (r.sample.job.contactEmail ?? r.sample.job.customer.contacts[0]?.email ?? null) : null,
      currentRevisionNo: r.currentRevisionNo,
      revisions: r.revisions.map((v) => this.revisionDto(v)),
      tests: tests.map((t) => ({ sampleTestId: t.id, testName: t.testName, status: t.status })),
      canReview: can('reports.review') && current.status !== 'APPROVED',
      canApprove: can('reports.approve') && (current.reviewedById !== me || (await this.settings.get('controls.allowSameReviewerSignatory'))),
      withheld: await this.withheld(this.prisma, r),
      reportRemarks: content.reportRemarks,
      sampleDescription: content.sampleDescription,
      customerReference: content.customerReference,
      kindAttention: content.customer.kindAttention,
      samplePhotos: (content.samplePhotos ?? []).map(({ fileId, caption, widthMm, heightMm }) => ({ fileId, caption, widthMm, heightMm })),
    };
  }

  private revisionDto(v: Revision) {
    return {
      id: v.id,
      revisionNo: v.revisionNo,
      status: v.status,
      revisionReason: v.revisionReason,
      ulrNumber: v.ulrNumber,
      reviewedByName: v.reviewedByName,
      reviewedAt: v.reviewedAt,
      approvedByName: v.approvedByName,
      approvedAt: v.approvedAt,
      issuedAt: v.issuedAt,
      supersededAt: v.supersededAt,
      pdfReady: !!v.pdfFileId,
      pdfSha256: v.pdfSha256,
      version: v.version,
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
    await tx.report.update({ where: { id: rev.reportId }, data: { latestStatus: to } });
  }

  /**
   * A cancelled sample or job must not leave the lab as a report. Taken under the job's lock, which cancelling also
   * takes, so one of the two always sees the other.
   */
  private async assertLive(tx: Tx, r: Full) {
    await this.jobs.lockJob(tx, r.sample.jobId);
    const sample = await tx.sample.findUniqueOrThrow({ where: { id: r.sample.id }, select: { status: true, job: { select: { status: true } } } });
    if (sample.status === 'CANCELLED' || sample.job.status === 'CANCELLED') throw rule('CANCELLED', 'This sample has been cancelled, so its report cannot go any further');
  }

  async submitForReview(id: string, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const rev = this.current(r);
      assertTransition(REPORT, rev.status, 'IN_REVIEW');
      await this.assertLive(tx, r);
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
      await this.assertLive(tx, r);
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
      await tx.reportRejection.create({
        data: {
          revisionId: rev.id,
          stage: rev.status,
          action: dto.action,
          reason: dto.reason,
          sampleTestIds: dto.action === 'RETEST' ? dto.sampleTestIds : undefined,
          byId: actorId(),
          byName: currentUser()!.name,
        },
      });
      await this.move(tx, rev, dto.version, 'DRAFT', { reviewedById: null, reviewedByName: null, reviewedAt: null });
      await this.audit.status(tx, { entity: 'Report', entityId: id, from: rev.status, to: 'DRAFT', reason: dto.reason, jobId: r.sample.jobId, meta: { action: dto.action } });
      if (dto.action === 'RETEST') {
        for (const testId of dto.sampleTestIds!) {
          const t = await tx.sampleTest.findFirst({ where: { id: testId, sampleId: r.sample.id, deletedAt: null } });
          if (!t) throw badRequest('That test is not on this report', [{ field: 'sampleTestIds', message: 'Not on this report' }]);
          assertTransition(TEST, t.status, 'IN_PROGRESS', dto.reason);
          await tx.sampleTest.update({
            where: { id: t.id },
            data: { status: 'IN_PROGRESS', rejectionReason: dto.reason, approvedAt: null, approvedById: null, submittedAt: null, version: { increment: 1 } },
          });
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
      const samplePhotos = dto.samplePhotos ? await this.checkPhotos(tx, r.id, r.sample.id, dto.samplePhotos) : before.samplePhotos;
      const content: ReportContent = {
        ...before,
        samplePhotos,
        ...(dto.reportRemarks !== undefined ? { reportRemarks: dto.reportRemarks } : {}),
        ...(dto.sampleDescription !== undefined ? { sampleDescription: dto.sampleDescription } : {}),
        ...(dto.customerReference !== undefined ? { customerReference: dto.customerReference } : {}),
        customer: { ...before.customer, ...(dto.kindAttention !== undefined ? { kindAttention: dto.kindAttention } : {}) },
      };
      const { count } = await tx.reportRevision.updateMany({ where: { id: rev.id, version: dto.version }, data: { content: content as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      if (count !== 1) throw conflict();
      await this.audit.record(
        {
          action: 'Report.corrected',
          entity: 'Report',
          entityId: id,
          before: { reportRemarks: before.reportRemarks, sampleDescription: before.sampleDescription, samplePhotos: before.samplePhotos?.map((p) => p.fileId) },
          after: dto,
        },
        tx,
      );
    });
    return this.get(id);
  }

  /**
   * Only images of this sample may go on its report: those taken at booking (on the sample) or added on the report.
   * Anything else, including another customer's photo id, is refused.
   */
  private async checkPhotos(tx: Tx, reportId: string, sampleId: string, chosen: ReportCorrectDto['samplePhotos'] & object): Promise<ReportPhoto[]> {
    const ids = chosen.map((p) => p.fileId);
    if (new Set(ids).size !== ids.length) throw badRequest('A photograph is listed twice', [{ field: 'samplePhotos', message: 'Listed twice' }]);
    const files = await tx.fileObject.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        OR: [
          { entity: 'Sample', entityId: sampleId, category: 'sample-image' },
          { entity: 'Report', entityId: reportId, category: 'report-photo' },
        ],
      },
      select: { id: true, mimeType: true },
    });
    const ok = new Set(files.filter((f) => f.mimeType.startsWith('image/')).map((f) => f.id));
    const bad = ids.filter((id) => !ok.has(id));
    if (bad.length) throw badRequest('Only photographs of this sample can be printed on its report', [{ field: 'samplePhotos', message: 'Not a photograph of this sample' }]);
    return chosen.map((p) => ({ fileId: p.fileId, caption: p.caption?.trim() || null, widthMm: p.widthMm, heightMm: p.heightMm }));
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
      await this.assertLive(tx, r);
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
        verificationCode: rev.verificationCode ?? newVerificationCode(),
      });
      await tx.reportSignature.create({
        data: { revisionId: rev.id, userId: me.id, name: user.name, designation: user.designation, signatureFileId: user.signatureFileId, ip: getContext()?.ip, contentSha256 },
      });
      await this.audit.status(tx, { entity: 'Report', entityId: id, from: rev.status, to: 'APPROVED', jobId: r.sample.jobId, meta: { contentSha256, ulrNumber } });
      return rev.id;
    });
    await this.queueFinalPdf(revisionId, me.id);
    return this.get(id);
  }

  private async queueFinalPdf(revisionId: string, userId: string | null) {
    const job = await this.prisma.documentJob.create({ data: { kind: REPORT_PDF, params: { revisionId, final: true }, createdById: userId } });
    await this.documents.queueExisting(job.id);
  }

  /** Re-renders the official PDF of an approved report that has none, from the frozen snapshot. */
  async regeneratePdf(id: string) {
    if (!can('reports.approve') && !can('reports.issue')) throw forbidden();
    const r = await this.load(id);
    const rev = this.current(r);
    if (rev.status !== 'APPROVED' || rev.pdfFileId) throw rule('PDF_NOT_MISSING', 'Only an approved report that has no final PDF yet can be regenerated');
    const running = await this.prisma.documentJob.findFirst({
      where: { kind: REPORT_PDF, status: { in: ['QUEUED', 'RUNNING'] }, createdAt: { gt: new Date(Date.now() - 2 * 60_000) }, params: { path: ['revisionId'], equals: rev.id } },
    });
    if (!running) await this.queueFinalPdf(rev.id, actorId() ?? null);
    await this.audit.record({ action: 'Report.pdfRegenerated', entity: 'Report', entityId: id, after: { revisionNo: rev.revisionNo } });
    return this.get(id);
  }

  /** Scheduled: approved revisions still without a final PDF ten minutes after approval are queued again. */
  async sweepMissingPdfs(): Promise<number> {
    const stale = await this.prisma.reportRevision.findMany({ where: { status: 'APPROVED', pdfFileId: null, approvedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, select: { id: true } });
    let queued = 0;
    for (const rev of stale) {
      const recent = await this.prisma.documentJob.findFirst({ where: { kind: REPORT_PDF, createdAt: { gt: new Date(Date.now() - 10 * 60_000) }, params: { path: ['revisionId'], equals: rev.id } } });
      if (recent) continue;
      await this.queueFinalPdf(rev.id, null);
      queued++;
    }
    return queued;
  }

  async issue(id: string, dto: ReportIssueDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const rev = this.current(r);
      assertTransition(REPORT, rev.status, 'ISSUED');
      await this.assertLive(tx, r);
      if (!rev.pdfFileId) throw rule('PDF_PENDING', 'The final PDF is still being prepared. Try again in a moment.');
      if (await this.withheld(tx, r)) throw rule('WITHHELD', 'This customer has report release withheld until payment is received');
      await this.move(tx, rev, dto.version, 'ISSUED', { issuedAt: new Date(), issuedById: actorId() });
      await tx.report.update({ where: { id }, data: { currentRevisionNo: rev.revisionNo } });
      await this.audit.status(tx, { entity: 'Report', entityId: id, from: rev.status, to: 'ISSUED', jobId: r.sample.jobId });
      if (rev.replacesRevisionId) {
        assertSystemTransition(REPORT, 'ISSUED', 'SUPERSEDED');
        await tx.reportRevision.update({ where: { id: rev.replacesRevisionId }, data: { status: 'SUPERSEDED', supersededAt: new Date(), version: { increment: 1 } } });
        await this.audit.status(tx, {
          entity: 'Report',
          entityId: id,
          from: 'ISSUED',
          to: 'SUPERSEDED',
          jobId: r.sample.jobId,
          reason: rev.revisionReason,
          meta: { replacedRevisionId: rev.replacesRevisionId },
        });
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
    const content = rev.content as unknown as ReportContent;
    const mail = await this.templates.render('report', {
      ...this.templates.commonValues(company),
      reportNo: r.reportNo,
      sampleNo: r.sample.sampleNo,
      revisionNo: rev.revisionNo || null,
      revisionReason: rev.revisionNo ? rev.revisionReason : null,
      contactName: content.customer?.kindAttention ?? 'Sir/Madam',
      customerName: content.customer?.name,
      verifyEmail: company.reportVerificationEmail,
    });
    await this.mail.enqueue({ to, cc, subject: mail.subject, template: 'report', entity: 'Report', entityId: id, attachmentFileIds: [rev.pdfFileId], bodyHtml: mail.bodyHtml });
    await this.audit.record({ action: 'Report.emailed', entity: 'Report', entityId: id, after: { to, revisionNo: rev.revisionNo } });
    return { ok: true };
  }

  async emails(id: string) {
    const rows = await this.prisma.emailLog.findMany({
      where: { entity: 'Report', entityId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, toAddress: true, ccAddress: true, subject: true, template: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
    });
    return hideEmailIdentity(rows);
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
      const content = await this.buildContent(tx, r.sample.id, {
        reportRemarks: old.reportRemarks,
        sampleDescription: old.sampleDescription,
        customerReference: old.customerReference,
        customer: old.customer,
        samplePhotos: old.samplePhotos,
      });
      const next = await tx.reportRevision.create({
        data: {
          reportId: id,
          revisionNo: rev.revisionNo + 1,
          revisionReason: reason,
          replacesRevisionId: rev.id,
          ulrNumber: rev.ulrNumber,
          content: content as unknown as Prisma.InputJsonValue,
          companySnapshot: this.company.snapshot() as unknown as Prisma.InputJsonValue,
          createdById: actorId(),
        },
      });
      await tx.report.update({ where: { id }, data: { latestStatus: 'DRAFT' } });
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
    return this.prisma.auditLog
      .findMany({ where: { entity: 'Report', entityId: id }, orderBy: { at: 'desc' }, take: 200 })
      .then((rows) => hideIdentity(rows).map((r) => ({ id: r.id.toString(), at: r.at, userName: r.userName, action: r.action, before: r.before, after: r.after, reason: r.reason })));
  }
}
