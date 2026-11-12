import { Injectable } from '@nestjs/common';
import { can, currentUser } from '../../common/context.js';
import { conflict, forbidden, notFound, rule } from '../../common/errors.js';
import { assertTransition, JOB, TEST } from '../../common/workflow.js';
import { AuditService } from '../../core/audit.service.js';
import { PrismaService, type Tx } from '../../core/prisma.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { TestingService } from '../testing/testing.service.js';
import type { CancelDto, CancelPreviewDto } from './cancellations.dto.js';

/**
 * Cancelling a job, sample or test. Cancelled records stay visible and reportable, and drop out of
 * billing. Nothing that has been issued to a customer is cancelled from here: an issued report
 * blocks it until a person decides how to correct that report.
 */
@Injectable()
export class CancellationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly invoices: InvoicesService,
    private readonly testing: TestingService,
  ) {}

  private assertPermission(type: CancelPreviewDto['type']) {
    const needed = type === 'test' ? ['jobs.cancel', 'planning.edit'] : ['jobs.cancel'];
    if (!needed.some((p) => can(p))) throw forbidden();
  }

  private async scope(tx: Tx | PrismaService, dto: CancelPreviewDto) {
    if (dto.type === 'job') {
      const job = await tx.job.findFirst({ where: { id: dto.id, deletedAt: null } });
      if (!job) throw notFound('Job');
      const samples = await tx.sample.findMany({ where: { jobId: job.id, status: { not: 'CANCELLED' } } });
      const tests = await tx.sampleTest.findMany({ where: { sampleId: { in: samples.map((s) => s.id) }, deletedAt: null, status: { not: 'CANCELLED' } } });
      return { jobId: job.id, samples, tests };
    }
    if (dto.type === 'sample') {
      const sample = await tx.sample.findFirst({ where: { id: dto.id, deletedAt: null } });
      if (!sample) throw notFound('Sample');
      const tests = await tx.sampleTest.findMany({ where: { sampleId: sample.id, deletedAt: null, status: { not: 'CANCELLED' } } });
      return { jobId: sample.jobId, samples: [sample], tests };
    }
    const test = await tx.sampleTest.findFirst({ where: { id: dto.id, deletedAt: null } });
    if (!test) throw notFound('Test');
    const sample = await tx.sample.findUniqueOrThrow({ where: { id: test.sampleId } });
    return { jobId: sample.jobId, samples: [] as (typeof sample)[], tests: [test] };
  }

  /** Shows the downstream effect before anything changes. */
  async preview(dto: CancelPreviewDto) {
    this.assertPermission(dto.type);
    const { samples, tests } = await this.scope(this.prisma, dto);
    const sampleIds = [...new Set([...samples.map((s) => s.id), ...tests.map((t) => t.sampleId)])];
    const sampleRows = await this.prisma.sample.findMany({ where: { id: { in: sampleIds } }, select: { id: true, sampleNo: true } });
    const nos = new Map(sampleRows.map((s) => [s.id, s.sampleNo]));
    const reports = await this.prisma.report.findMany({ where: { sampleId: { in: sampleIds } }, include: { revisions: { orderBy: { revisionNo: 'desc' } } } });
    const lines = await this.prisma.invoiceLine.findMany({
      where: { sampleTestId: { in: tests.map((t) => t.id) }, invoice: { status: { not: 'CANCELLED' } } },
      include: { invoice: { select: { id: true, invoiceNo: true, status: true } } },
    });
    const blockers: string[] = [];
    const issued = reports.filter((r) => r.revisions.some((v) => ['APPROVED', 'ISSUED'].includes(v.status)));
    if (dto.type === 'test') {
      const t = tests[0];
      if (t.status === 'CANCELLED') blockers.push('This test is already cancelled.');
      if (issued.length) blockers.push(`${issued[0].reportNo} has been approved. Revise that report instead of cancelling the test.`);
      else if (t.status === 'APPROVED') blockers.push('This test has been approved and is locked.');
    } else if (issued.length) {
      blockers.push(`These reports have been approved or issued: ${issued.map((r) => r.reportNo).join(', ')}. Revise them instead.`);
    }
    return {
      canCancel: blockers.length === 0,
      blockers,
      samples: sampleRows.filter((s) => samples.some((x) => x.id === s.id)),
      tests: tests.map((t) => ({ id: t.id, sampleNo: nos.get(t.sampleId) ?? '', testName: t.testName, status: t.status })),
      reports: reports.map((r) => ({ id: r.id, reportNo: r.reportNo, status: r.revisions[0].status })),
      draftInvoiceLines: can('invoices.view') ? lines.filter((l) => l.invoice.status === 'DRAFT').map((l) => ({ invoiceId: l.invoice.id, description: l.description })) : [],
      issuedInvoiceLines: can('invoices.view')
        ? lines.filter((l) => l.invoice.status !== 'DRAFT').map((l) => ({ invoiceId: l.invoice.id, invoiceNo: l.invoice.invoiceNo, description: l.description }))
        : [],
    };
  }

  async cancel(dto: CancelDto) {
    this.assertPermission(dto.type);
    const impact = await this.preview(dto);
    if (!impact.canCancel) throw rule('CANNOT_CANCEL', impact.blockers.join(' '));
    await this.prisma.$transaction(async (tx) => {
      const { jobId, samples, tests } = await this.scope(tx, dto);
      // Checked again under the job lock: a report approved since the preview must still block the cancellation.
      await this.jobs.lockJob(tx, jobId);
      const sampleIds = [...new Set([...samples.map((s) => s.id), ...tests.map((t) => t.sampleId)])];
      const approved = await tx.report.findFirst({ where: { sampleId: { in: sampleIds }, revisions: { some: { status: { in: ['APPROVED', 'ISSUED'] } } } }, select: { reportNo: true } });
      if (approved) throw rule('CANNOT_CANCEL', `${approved.reportNo} has been approved. Revise that report instead.`);
      if (dto.type === 'test' && tests[0]?.status === 'APPROVED') throw rule('CANNOT_CANCEL', 'This test has been approved and is locked.');
      if (dto.type === 'job') {
        const job = await tx.job.findUniqueOrThrow({ where: { id: dto.id } });
        assertTransition(JOB, job.status, 'CANCELLED', dto.reason);
        const { count } = await tx.job.updateMany({
          where: { id: dto.id, version: dto.version },
          data: { status: 'CANCELLED', cancelReason: dto.reason, holdReason: null, statusBeforeHold: null, version: { increment: 1 } },
        });
        if (count !== 1) throw conflict();
        await this.audit.status(tx, { entity: 'Job', entityId: dto.id, from: job.status, to: 'CANCELLED', reason: dto.reason, jobId });
      } else if (dto.type === 'sample') {
        const { count } = await tx.sample.updateMany({
          where: { id: dto.id, version: dto.version, status: { not: 'CANCELLED' } },
          data: { status: 'CANCELLED', cancelReason: dto.reason, version: { increment: 1 } },
        });
        if (count !== 1) throw conflict();
        await this.audit.status(tx, { entity: 'Sample', entityId: dto.id, from: samples[0].status, to: 'CANCELLED', reason: dto.reason, jobId });
      }
      for (const s of dto.type === 'job' ? samples : []) {
        await tx.sample.update({ where: { id: s.id }, data: { status: 'CANCELLED', cancelReason: dto.reason, version: { increment: 1 } } });
        await this.audit.status(tx, { entity: 'Sample', entityId: s.id, from: s.status, to: 'CANCELLED', reason: dto.reason, jobId });
      }
      for (const t of tests) {
        if (dto.type === 'test') {
          assertTransition(TEST, t.status, 'CANCELLED', dto.reason);
          const { count } = await tx.sampleTest.updateMany({ where: { id: t.id, version: dto.version }, data: { status: 'CANCELLED', cancelReason: dto.reason, version: { increment: 1 } } });
          if (count !== 1) throw conflict();
        } else {
          await tx.sampleTest.update({ where: { id: t.id }, data: { status: 'CANCELLED', cancelReason: dto.reason, version: { increment: 1 } } });
        }
        await this.audit.status(tx, { entity: 'SampleTest', entityId: t.id, from: t.status, to: 'CANCELLED', reason: dto.reason, jobId });
      }
      await this.invoices.removeFromDrafts(
        tx,
        tests.map((t) => t.id),
      );
      await this.audit.record(
        {
          action: 'Cancellation',
          entity: dto.type === 'job' ? 'Job' : dto.type === 'sample' ? 'Sample' : 'SampleTest',
          entityId: dto.id,
          after: { by: currentUser()?.name, tests: tests.length },
          reason: dto.reason,
        },
        tx,
      );
      if (dto.type !== 'job') await this.jobs.syncStatus(tx, jobId);
      // Cancelling a sample's last open test, with the rest approved, makes it ready for its report.
      if (dto.type === 'test') {
        const sampleId = tests[0].sampleId;
        const [open, approvedCount] = await Promise.all([
          tx.sampleTest.count({ where: { sampleId, deletedAt: null, status: { notIn: ['APPROVED', 'CANCELLED'] } } }),
          tx.sampleTest.count({ where: { sampleId, deletedAt: null, status: 'APPROVED' } }),
        ]);
        if (open === 0 && approvedCount > 0) await this.testing.onAllApproved?.(tx, sampleId);
      }
    });
    return { ok: true };
  }
}
