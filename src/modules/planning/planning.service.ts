import { Injectable, OnModuleInit } from '@nestjs/common';
import { actorId } from '../../common/context.js';
import { addWorkingDays } from '../../common/calendar.js';
import { badRequest, conflict, notFound, rule } from '../../common/errors.js';
import { istToday } from '../../common/india.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { assertTransition, TEST } from '../../common/workflow.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { DocumentsService, requirePermission } from '../documents/documents.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PdfService } from '../pdf/pdf.service.js';
import { jobCardHtml } from '../pdf/templates/job-documents.js';
import type { AssignDto, PlanningQuery, PlanSamplesDto, SuggestQuery } from './planning.dto.js';

const rowInclude = {
  sample: { select: { sampleNo: true, description: true, jobId: true, job: { select: { jobNo: true } } } },
  assignedTo: { select: { name: true } },
  instrument: { select: { name: true } },
} as const;
type Row = Prisma.SampleTestGetPayload<{ include: typeof rowInclude }>;

const toRow = (t: Row) => ({
  id: t.id, sampleId: t.sampleId, sampleNo: t.sample.sampleNo, sampleDescription: t.sample.description, jobId: t.sample.jobId, jobNo: t.sample.job.jobNo, testId: t.testId, testCode: t.testCode, testName: t.testName, methodName: t.methodName, status: t.status, urgent: t.urgent,
  planned: !!t.plannedAt, dueDate: t.dueDate, assignedToId: t.assignedToId, assignedToName: t.assignedTo?.name ?? null, instrumentId: t.instrumentId, instrumentName: t.instrument?.name ?? null, version: t.version,
});

/** A method and parameter must both be in scope and unexpired on the given date. */
export function isAccredited(flag: boolean, until: Date | null, on: Date): boolean {
  return flag && (!until || until >= on);
}

@Injectable()
export class PlanningService implements OnModuleInit {
  notifyAssigned: ((tx: Tx, sampleTestId: string, userId: string) => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly company: CompanyService,
  ) {}

  onModuleInit() {
    this.documents.register('job-card', {
      authorize: requirePermission('planning.view', 'tests.viewAll'),
      run: async (p) => this.renderJobCard(String(p.jobId)),
    });
  }

  /** Impartial by default: the card carries codes only. Showing the customer needs the control off. */
  private async renderJobCard(jobId: string) {
    const job = await this.prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        customer: { select: { name: true } },
        samples: { include: { tests: { where: { deletedAt: null, status: { not: 'CANCELLED' }, plannedAt: { not: null } }, include: { assignedTo: { select: { name: true } }, instrument: { select: { name: true } }, results: { orderBy: { sortOrder: 'asc' } }, stages: { orderBy: { seq: 'asc' } } } } } },
      },
    });
    const impartial = await this.settings.get('controls.impartiality');
    const tests = job.samples.flatMap((s) =>
      s.tests.map((t) => ({
        testName: t.testName, methodName: t.methodName, sampleNo: s.sampleNo, sampleDescription: s.description, dueDate: t.dueDate, urgent: t.urgent, assignee: t.assignedTo?.name ?? null, instrument: t.instrument?.name ?? null, analysisMode: t.analysisMode, officeInstructions: t.officeInstructions, technicalData: t.technicalData,
        parameters: t.results.map((r) => r.name), stages: t.stages.map((x) => x.name),
      })),
    );
    const company = this.company.snapshot();
    const html = jobCardHtml({ jobNo: job.jobNo, customerName: impartial ? null : job.customer.name, tests }, company);
    return { buffer: await this.pdf.render(html, { company }), filename: `Job card ${job.jobNo}.pdf`.replace(/[/\\]/g, '-'), mimeType: 'application/pdf', entity: 'Job', entityId: job.id };
  }

  /** Suggests tests and parameters from a grade or a group. */
  async suggest(q: SuggestQuery) {
    if (!q.specificationId && !q.groupId) throw badRequest('Choose a specification or a group');
    const params = new Map<string, Set<string>>();
    const testIds = new Set<string>();
    for (const specId of [q.specificationId, q.dualSpecificationId].filter(Boolean) as string[]) {
      const limits = await this.prisma.specificationLimit.findMany({ where: { specificationId: specId, deletedAt: null }, include: { parameter: { select: { testId: true } } } });
      for (const l of limits) {
        testIds.add(l.parameter.testId);
        params.set(l.parameter.testId, (params.get(l.parameter.testId) ?? new Set()).add(l.parameterId));
      }
    }
    if (q.groupId) {
      const items = await this.prisma.testGroupItem.findMany({ where: { groupId: q.groupId } });
      for (const i of items) {
        testIds.add(i.testId);
        if (i.parameterId) params.set(i.testId, (params.get(i.testId) ?? new Set()).add(i.parameterId));
      }
    }
    const tests = await this.prisma.testMaster.findMany({ where: { id: { in: [...testIds] }, deletedAt: null, isActive: true }, include: { method: true, parameters: { where: { deletedAt: null, isActive: true }, orderBy: { sortOrder: 'asc' } } }, orderBy: { name: 'asc' } });
    return tests.map((t) => ({
      testId: t.id, testCode: t.code, testName: t.name, methodName: t.method ? [t.method.name, t.method.standardRef].filter(Boolean).join(', ') : null, category: t.category, defaultTatDays: t.defaultTatDays,
      parameters: t.parameters.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    }));
  }

  async dueDate(tx: Tx, testTat: { defaultTatDays: number; urgentTatDays: number }, urgent: boolean, from: Date): Promise<Date> {
    const workingDays = await this.settings.get('calendar.workingDays', tx);
    const holidays = await tx.holiday.findMany({ where: { deletedAt: null, date: { gte: from } }, select: { date: true } });
    return addWorkingDays(from, urgent ? testTat.urgentTatDays : testTat.defaultTatDays, workingDays, new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))));
  }

  /** Limits and accreditation are frozen on each result row so later master edits can't alter this test. */
  private async buildResultRows(tx: Tx, sampleTestId: string, testId: string, specificationId: string | null, dualSpecificationId: string | null, methodAccredited: boolean) {
    const params = await tx.testParameter.findMany({ where: { testId, deletedAt: null, isActive: true }, orderBy: { sortOrder: 'asc' }, include: { unit: true } });
    const specIds = [specificationId, dualSpecificationId].filter(Boolean) as string[];
    const specs = await tx.specification.findMany({ where: { id: { in: specIds } }, include: { limits: { where: { deletedAt: null } } } });
    const today = istToday();
    for (const p of params) {
      const limits = specIds
        .map((id, i) => {
          const spec = specs.find((s) => s.id === id)!;
          const l = spec.limits.find((x) => x.parameterId === p.id);
          return l ? { spec: spec.code, role: i === 0 ? 'primary' : 'dual', min: l.minValue === null ? null : String(l.minValue), max: l.maxValue === null ? null : String(l.maxValue), text: l.textLimit } : null;
        })
        .filter(Boolean);
      await tx.parameterResult.upsert({
        where: { sampleTestId_parameterId: { sampleTestId, parameterId: p.id } },
        create: { sampleTestId, parameterId: p.id, code: p.code, name: p.name, kind: p.kind, unit: p.unit?.symbol ?? null, decimals: p.decimals, sortOrder: p.sortOrder, accredited: methodAccredited && isAccredited(p.accredited, p.accreditedUntil, today), limits: limits as Prisma.InputJsonValue },
        update: { limits: limits as Prisma.InputJsonValue },
      });
    }
    if (!params.length) throw rule('NO_PARAMETERS', 'This test has no parameters. Add them in Masters before planning.');
  }

  async plan(dto: PlanSamplesDto) {
    return this.prisma.$transaction(async (tx) => {
      const samples = await tx.sample.findMany({ where: { id: { in: dto.sampleIds }, deletedAt: null }, include: { job: true } });
      if (samples.length !== dto.sampleIds.length) throw notFound('Sample');
      const jobIds = [...new Set(samples.map((s) => s.jobId))];
      if (jobIds.length !== 1) throw badRequest('Plan samples from one job at a time');
      const job = samples[0].job;
      if (['ON_HOLD', 'CANCELLED', 'COMPLETED'].includes(job.status)) throw rule('JOB_NOT_PLANNABLE', `This job is ${job.status.toLowerCase().replace('_', ' ')} and cannot be planned`);
      if (samples.some((s) => s.status === 'CANCELLED')) throw rule('SAMPLE_CANCELLED', 'A cancelled sample cannot be planned');
      if (dto.dualSpecificationId && dto.dualSpecificationId === dto.specificationId) throw badRequest('Choose two different grades for dual grade', [{ field: 'dualSpecificationId', message: 'Must differ from the first grade' }]);
      const planNo = await this.numbering.next(tx, 'PLAN');
      const plan = await tx.plan.create({ data: { planNo, jobId: job.id, notes: dto.notes, createdById: actorId() } });
      const ids: string[] = [];
      const today = istToday();
      for (const sample of samples) {
        await tx.sample.update({ where: { id: sample.id }, data: { specificationId: dto.specificationId ?? null, dualSpecificationId: dto.dualSpecificationId ?? null } });
        for (const t of dto.tests) {
          const master = await tx.testMaster.findFirst({ where: { id: t.testId, deletedAt: null }, include: { method: true } });
          if (!master) throw badRequest('A selected test no longer exists', [{ field: 'tests', message: 'Unknown test' }]);
          if (t.analysisMode && master.category !== 'CHEMICAL') throw badRequest(`Spectro or Wet applies to chemical tests only (${master.name})`, [{ field: 'tests', message: 'Analysis mode is for chemical tests' }]);
          let row = await tx.sampleTest.findFirst({ where: { sampleId: sample.id, testId: t.testId, deletedAt: null, status: { not: 'CANCELLED' } } });
          if (row?.plannedAt) throw rule('ALREADY_PLANNED', `${master.name} is already planned on ${sample.sampleNo}`);
          if (!row) {
            await this.jobs.addRequestedTests(tx, sample.id, [t.testId], job.customerId, job.urgent);
            row = await tx.sampleTest.findFirstOrThrow({ where: { sampleId: sample.id, testId: t.testId, status: { not: 'CANCELLED' } } });
          }
          const stages = (master.stages as string[]).length ? (master.stages as string[]) : ['Analysis'];
          const dueDate = await this.dueDate(tx, master, job.urgent, today);
          await tx.sampleTest.update({
            where: { id: row.id },
            data: { planId: plan.id, plannedAt: new Date(), analysisMode: t.analysisMode ?? null, officeInstructions: t.officeInstructions ?? null, technicalData: t.technicalData ?? null, specificationId: dto.specificationId ?? null, dualSpecificationId: dto.dualSpecificationId ?? null, dueDate, urgent: job.urgent, instrumentId: t.instrumentId ?? null, currentStage: stages[0], version: { increment: 1 } },
          });
          await tx.sampleTestStage.createMany({ data: stages.map((name, seq) => ({ sampleTestId: row!.id, seq, name })) });
          const methodOk = master.method ? isAccredited(master.method.accredited, master.method.accreditedUntil, today) : false;
          await this.buildResultRows(tx, row.id, t.testId, dto.specificationId ?? null, dto.dualSpecificationId ?? null, isAccredited(master.accredited, master.accreditedUntil, today) && methodOk);
          await this.audit.status(tx, { entity: 'SampleTest', entityId: row.id, from: null, to: 'PLANNED', jobId: job.id });
          ids.push(row.id);
          if (t.assignedToId) await this.assignOne(tx, row.id, t.assignedToId, t.instrumentId ?? null);
        }
      }
      await this.audit.record({ action: 'Plan.create', entity: 'Plan', entityId: plan.id, after: { planNo, jobId: job.id, tests: ids.length } }, tx);
      await this.jobs.syncStatus(tx, job.id);
      return { planId: plan.id, planNo, sampleTestIds: ids };
    });
  }

  private async assertAssignable(tx: Tx, assignedToId: string, instrumentId: string | null) {
    const user = await tx.user.findFirst({ where: { id: assignedToId, isActive: true, deletedAt: null, roles: { some: { role: { permissions: { some: { permissionCode: 'tests.work' } } } } } } });
    if (!user) throw badRequest('That person cannot be assigned tests', [{ field: 'assignedToId', message: 'Not a technician' }]);
    if (instrumentId) {
      const instrument = await tx.instrument.findFirst({ where: { id: instrumentId, isActive: true, deletedAt: null } });
      if (!instrument) throw badRequest('That instrument is not available', [{ field: 'instrumentId', message: 'Not available' }]);
    }
  }

  private async assignOne(tx: Tx, sampleTestId: string, assignedToId: string, instrumentId: string | null) {
    await this.assertAssignable(tx, assignedToId, instrumentId);
    const t = await tx.sampleTest.findFirst({ where: { id: sampleTestId, deletedAt: null }, include: { sample: { select: { jobId: true, job: { select: { status: true } } } } } });
    if (!t) throw notFound('Test');
    if (t.sample.job.status === 'ON_HOLD' || t.sample.job.status === 'CANCELLED') throw rule('JOB_NOT_ACTIVE', 'This job is not active');
    if (!t.plannedAt) throw rule('NOT_PLANNED', `${t.testName} must be planned before it is assigned`);
    if (t.status === 'PLANNED') {
      assertTransition(TEST, 'PLANNED', 'ASSIGNED');
      await tx.sampleTest.update({ where: { id: t.id }, data: { status: 'ASSIGNED', assignedToId, assignedAt: new Date(), instrumentId: instrumentId ?? t.instrumentId, version: { increment: 1 } } });
      await this.audit.status(tx, { entity: 'SampleTest', entityId: t.id, from: 'PLANNED', to: 'ASSIGNED', jobId: t.sample.jobId, meta: { assignedToId } });
      await this.notifyAssigned?.(tx, t.id, assignedToId);
    } else if (t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS' || t.status === 'ON_HOLD') {
      // Reassignment keeps the status; it is still recorded who it moved from.
      await tx.sampleTest.update({ where: { id: t.id }, data: { assignedToId, assignedAt: new Date(), instrumentId: instrumentId ?? t.instrumentId, version: { increment: 1 } } });
      await this.audit.record({ action: 'SampleTest.reassign', entity: 'SampleTest', entityId: t.id, before: { assignedToId: t.assignedToId }, after: { assignedToId } }, tx);
      if (t.assignedToId !== assignedToId) await this.notifyAssigned?.(tx, t.id, assignedToId);
    } else {
      throw rule('NOT_ASSIGNABLE', `${t.testName} is ${t.status.toLowerCase().replace('_', ' ')} and cannot be reassigned`);
    }
  }

  /** Bulk assignment and reassignment. All or nothing. */
  async assign(dto: AssignDto) {
    await this.prisma.$transaction(async (tx) => {
      for (const id of dto.sampleTestIds) {
        const expected = dto.versions?.[id];
        if (expected !== undefined) {
          const current = await tx.sampleTest.findUnique({ where: { id }, select: { version: true } });
          if (current?.version !== expected) throw conflict();
        }
        await this.assignOne(tx, id, dto.assignedToId, dto.instrumentId ?? null);
      }
    });
    return { ok: true };
  }

  async list(q: PlanningQuery) {
    const view = q.view ?? 'unplanned';
    const where: Prisma.SampleTestWhereInput = {
      deletedAt: null,
      status: { not: 'CANCELLED' },
      sample: { status: { not: 'CANCELLED' }, job: { status: { notIn: ['CANCELLED', 'ON_HOLD'] } }, ...(q.jobId ? { jobId: q.jobId } : {}) },
      ...(view === 'unplanned' ? { plannedAt: null } : view === 'unassigned' ? { plannedAt: { not: null }, status: 'PLANNED' } : { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } }),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      ...(q.q ? { OR: [{ testName: { contains: q.q, mode: 'insensitive' } }, { sample: { sampleNo: { contains: q.q, mode: 'insensitive' } } }, { sample: { job: { jobNo: { contains: q.q, mode: 'insensitive' } } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sampleTest.findMany({ where, include: rowInclude, orderBy: [{ urgent: 'desc' }, orderBy(q, ['dueDate', 'createdAt', 'testName'], 'createdAt', 'asc')], ...skipTake(q) }),
      this.prisma.sampleTest.count({ where }),
    ]);
    return toPage(rows.map(toRow), total, q);
  }

  /** Open work per technician and instrument, shown when assigning. */
  async workload() {
    const today = istToday();
    const open = await this.prisma.sampleTest.findMany({
      where: { deletedAt: null, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } },
      select: { assignedToId: true, instrumentId: true, status: true, dueDate: true, urgent: true },
    });
    const tally = (key: 'assignedToId' | 'instrumentId') => {
      const map = new Map<string, { openTests: number; inProgress: number; overdue: number; urgent: number }>();
      for (const t of open) {
        const id = t[key];
        if (!id) continue;
        const m = map.get(id) ?? { openTests: 0, inProgress: 0, overdue: 0, urgent: 0 };
        m.openTests++;
        if (t.status === 'IN_PROGRESS') m.inProgress++;
        if (t.dueDate && t.dueDate < today) m.overdue++;
        if (t.urgent) m.urgent++;
        map.set(id, m);
      }
      return map;
    };
    const techs = await this.technicians();
    const instruments = await this.prisma.instrument.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: 'asc' } });
    const empty = { openTests: 0, inProgress: 0, overdue: 0, urgent: 0 };
    const byTech = tally('assignedToId');
    const byInst = tally('instrumentId');
    return {
      technicians: techs.map((t) => ({ id: t.id, name: t.name, ...(byTech.get(t.id) ?? empty) })),
      instruments: instruments.map((i) => ({ id: i.id, name: i.name, ...(byInst.get(i.id) ?? empty) })),
    };
  }

  technicians() {
    return this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null, roles: { some: { role: { isActive: true, permissions: { some: { permissionCode: 'tests.work' } } } } } },
      select: { id: true, name: true, departmentId: true },
      orderBy: { name: 'asc' },
    });
  }

  async instruments() {
    const rows = await this.prisma.instrument.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: 'asc' } });
    const today = istToday();
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, departmentId: r.departmentId, calibrationDueAt: r.calibrationDueAt, calibrationOverdue: !!r.calibrationDueAt && r.calibrationDueAt < today }));
  }
}
