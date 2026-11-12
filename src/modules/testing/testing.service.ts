import { Injectable, OnModuleInit } from '@nestjs/common';
import { actorId, can, currentUser } from '../../common/context.js';
import { AppError, badRequest, conflict, forbidden, notFound, rule } from '../../common/errors.js';
import { formatDate, istToday } from '../../common/india.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { assertTransition, TEST } from '../../common/workflow.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { Prisma, PrismaService, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PdfService } from '../pdf/pdf.service.js';
import { testDataHtml } from '../pdf/templates/test-data.js';
import { computeResults, enteredValue, overallOutcome, type LimitSnapshot, type ParamRow } from './calc.js';
import type { ApprovalQuery, SaveResultsDto, WorklistQuery } from './testing.dto.js';

const listInclude = {
  sample: { select: { sampleNo: true, description: true, jobId: true, job: { select: { jobNo: true, status: true, customer: { select: { name: true } } } } } },
  stages: { orderBy: { seq: 'asc' } },
} as const;
type ListRow = Prisma.SampleTestGetPayload<{ include: typeof listInclude }>;

const detailInclude = {
  ...listInclude,
  results: { orderBy: { sortOrder: 'asc' }, include: { calculations: { orderBy: { createdAt: 'desc' }, take: 1, include: { formulaVersion: { select: { versionNo: true } } } } } },
  assignedTo: { select: { name: true } },
} as const;
type DetailRow = Prisma.SampleTestGetPayload<{ include: typeof detailInclude }>;

const EDITABLE: string[] = ['IN_PROGRESS'];
export const ALL_STAGES_DONE = 'All stages complete';

/** Hook set by the Reports module: when a sample's tests are all approved a draft is created. */
export type AllApprovedHook = (tx: Tx, sampleId: string) => Promise<void>;

/** A stored numeric value at its decimals, as it would be computed again, so unchanged values don't count as edits. */
function normaliseValue(value: string, decimals: number): string {
  const m = /^([<>]?)(-?\d+(?:\.\d+)?)$/.exec(value);
  return m ? `${m[1]}${new Prisma.Decimal(m[2]).toFixed(decimals)}` : value;
}

@Injectable()
export class TestingService implements OnModuleInit {
  onAllApproved: AllApprovedHook | null = null;
  /** Notification hook; set by Notifications module. */
  notify: ((tx: Tx, event: { type: 'TEST_REJECTED' | 'RESULTS_SUBMITTED'; sampleTestId: string; reason?: string }) => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly company: CompanyService,
  ) {}

  onModuleInit() {
    this.documents.register('test-data', {
      authorize: async (p) => {
        const test = await this.prisma.sampleTest.findUnique({ where: { id: String(p.sampleTestId) }, select: { assignedToId: true } });
        if (!test) throw notFound('Test');
        if (!(can('tests.viewAll') || (can('tests.work') && test.assignedToId === currentUser()?.id))) throw forbidden();
      },
      run: async (p) => {
        const t = await this.prisma.sampleTest.findUniqueOrThrow({ where: { id: String(p.sampleTestId) }, include: detailInclude });
        const company = this.company.snapshot();
        const html = testDataHtml(
          {
            testName: t.testName,
            methodName: t.methodName,
            sampleNo: t.sample.sampleNo,
            jobNo: t.sample.job.jobNo,
            sampleDescription: t.sample.description,
            conductedByName: t.conductedByName,
            assignedToName: t.assignedTo?.name ?? null,
            status: t.status,
            stages: t.stages,
            remarks: t.remarks,
            observations: t.observations,
            notes: t.notes,
            results: t.results.map((r) => ({ name: r.name, unit: r.unit, value: enteredValue(r), working: r.calculations[0]?.working ?? null })),
          },
          company,
        );
        return {
          buffer: await this.pdf.render(html, { company }),
          filename: `Test data ${t.sample.sampleNo} ${t.testCode}.pdf`.replace(/[/\\]/g, '-'),
          mimeType: 'application/pdf',
          entity: 'SampleTest',
          entityId: t.id,
        };
      },
    });
  }

  // ---------------------------------------------------------------- access
  private assertCanRead(t: { assignedToId: string | null }) {
    if (can('tests.viewAll')) return;
    if (can('tests.work') && t.assignedToId === currentUser()?.id) return;
    // Same answer as a missing record: don't confirm which tests exist.
    throw notFound('Test');
  }

  private assertAssignee(t: { assignedToId: string | null }) {
    if (!can('tests.work')) throw forbidden();
    if (t.assignedToId !== currentUser()?.id) throw new AppError('NOT_ASSIGNEE', 403, 'This test is assigned to someone else');
  }

  private assertJobActive(t: { sample: { job: { status: string } } }) {
    if (t.sample.job.status === 'ON_HOLD') throw rule('JOB_ON_HOLD', 'This job is on hold');
    if (t.sample.job.status === 'CANCELLED') throw rule('JOB_CANCELLED', 'This job has been cancelled');
  }

  // ---------------------------------------------------------------- worklist
  private async listItem(t: ListRow, hideCustomer?: boolean) {
    const today = istToday();
    // Impartiality is on by default; customer identity then never leaves through test endpoints.
    const impartial = hideCustomer ?? (await this.settings.get('controls.impartiality'));
    return {
      id: t.id,
      testCode: t.testCode,
      testName: t.testName,
      methodName: t.methodName,
      status: t.status,
      urgent: t.urgent,
      dueDate: t.dueDate,
      overdue: !!t.dueDate && t.dueDate < today && !['APPROVED', 'CANCELLED'].includes(t.status),
      sampleNo: t.sample.sampleNo,
      jobNo: t.sample.job.jobNo,
      sampleDescription: t.sample.description,
      customerName: impartial ? null : t.sample.job.customer.name,
      currentStage: t.stages.find((s) => !s.completedAt)?.name ?? null,
      rejectionReason: t.rejectionReason,
      holdReason: t.holdReason,
      version: t.version,
      analysisMode: t.analysisMode,
    };
  }

  /** Assigned tests only, most urgent then soonest due. */
  async worklist(q: WorklistQuery) {
    const open = (q.view ?? 'open') !== 'done';
    const where: Prisma.SampleTestWhereInput = {
      deletedAt: null,
      assignedToId: actorId(),
      status: open ? { in: ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } : { in: ['RESULTS_SUBMITTED', 'APPROVED'] },
      sample: { job: { status: { not: 'CANCELLED' } } },
      ...(q.q
        ? {
            OR: [
              { testName: { contains: q.q, mode: 'insensitive' } },
              { sample: { sampleNo: { contains: q.q, mode: 'insensitive' } } },
              { sample: { job: { jobNo: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sampleTest.findMany({ where, include: listInclude, orderBy: [{ urgent: 'desc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], ...skipTake(q) }),
      this.prisma.sampleTest.count({ where }),
    ]);
    // The impartiality setting is read once for the page, not once per row.
    const impartial = await this.settings.get('controls.impartiality');
    return toPage(await Promise.all(rows.map((r) => this.listItem(r, impartial))), total, q);
  }

  private async paramRows(tx: Tx | PrismaService, results: DetailRow['results']): Promise<ParamRow[]> {
    const parameters = await tx.testParameter.findMany({
      where: { id: { in: results.map((r) => r.parameterId) } },
      include: { resultSet: { include: { options: { orderBy: { sortOrder: 'asc' } } } }, formula: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
    });
    const byId = new Map(parameters.map((p) => [p.id, p]));
    return results.map((r) => {
      const p = byId.get(r.parameterId);
      const version = p?.formula?.versions[0];
      return {
        parameterId: r.parameterId,
        code: r.code,
        kind: r.kind,
        decimals: r.decimals,
        limits: (r.limits as unknown as LimitSnapshot[] | null) ?? [],
        options: p?.resultSet?.options.map((o) => ({ value: o.value, isPass: o.isPass })) ?? [],
        formula: version ? { versionId: version.id, expression: version.expression, bindings: (p?.formulaBindings as Record<string, string> | null) ?? {} } : null,
      };
    });
  }

  private resultView(t: DetailRow, params: ParamRow[]) {
    const entered = Object.fromEntries(t.results.map((r) => [r.parameterId, enteredValue(r)]));
    const computed = new Map(computeResults(params, entered).map((c) => [c.parameterId, c]));
    const byParam = new Map(params.map((p) => [p.parameterId, p]));
    return t.results.map((r) => {
      const c = computed.get(r.parameterId)!;
      const stored = r.calculations[0];
      const locked = !EDITABLE.includes(t.status);
      const numeric = locked ? (r.numericValue !== null ? new Prisma.Decimal(r.numericValue).toFixed(r.decimals) : null) : c.numericValue;
      const qualifier = locked ? r.qualifier : c.qualifier;
      return {
        parameterId: r.parameterId,
        code: r.code,
        name: r.name,
        kind: r.kind,
        unit: r.unit,
        decimals: r.decimals,
        accredited: r.accredited,
        // Written as typed, so "<0.005" comes back into the input unchanged.
        value: numeric !== null ? `${qualifier ?? ''}${numeric}` : locked ? r.textValue : c.textValue,
        numericValue: numeric,
        qualifier: qualifier ?? null,
        textValue: locked ? r.textValue : c.textValue,
        limits: (r.limits as unknown as LimitSnapshot[] | null) ?? [],
        passPrimary: locked ? r.passPrimary : c.passPrimary,
        passDual: locked ? r.passDual : c.passDual,
        options: byParam.get(r.parameterId)?.options ?? [],
        calculation:
          stored && locked
            ? { inputs: stored.inputs as Record<string, string>, working: stored.working, result: String(stored.result), formulaVersion: stored.formulaVersion.versionNo }
            : c.calculation
              ? { inputs: c.calculation.inputs, working: c.calculation.working, result: c.calculation.result, formulaVersion: null }
              : null,
        error: locked ? null : c.error,
      };
    });
  }

  private async instrumentWarning(instrumentId: string | null) {
    if (!instrumentId) return null;
    const i = await this.prisma.instrument.findUnique({ where: { id: instrumentId } });
    if (i?.calibrationDueAt && i.calibrationDueAt < istToday()) return `${i.name} was due for calibration on ${formatDate(i.calibrationDueAt)}`;
    return null;
  }

  async detail(id: string) {
    const t = await this.prisma.sampleTest.findFirst({ where: { id, deletedAt: null }, include: detailInclude });
    if (!t) throw notFound('Test');
    this.assertCanRead(t);
    const params = await this.paramRows(this.prisma, t.results);
    const results = this.resultView(t, params);
    const outcome = overallOutcome(results);
    const today = istToday();
    const instruments = await this.prisma.instrument.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: 'asc' } });
    const conversions = await this.prisma.unitConversion.findMany({ where: { isActive: true, deletedAt: null }, include: { fromUnit: true, toUnit: true } });
    const templates = await this.prisma.remarkTemplate.findMany({ where: { isActive: true, deletedAt: null, OR: [{ testId: t.testId }, { testId: null }] }, orderBy: { code: 'asc' } });
    const approver = t.approvedById ? await this.prisma.user.findUnique({ where: { id: t.approvedById }, select: { name: true } }) : null;
    return {
      ...(await this.listItem(t)),
      sampleId: t.sampleId,
      officeInstructions: t.officeInstructions,
      technicalData: t.technicalData,
      instrumentId: t.instrumentId,
      remarks: t.remarks,
      observations: t.observations,
      notes: t.notes,
      conductedByName: t.conductedByName,
      assignedToMe: t.assignedToId === actorId(),
      canEdit: t.status === 'IN_PROGRESS' && t.assignedToId === actorId() && can('tests.work') && t.sample.job.status !== 'ON_HOLD',
      blockOverdueInstruments: await this.settings.get('controls.blockOverdueInstruments'),
      instrumentWarning: await this.instrumentWarning(t.instrumentId),
      stages: t.stages.map((s) => ({ seq: s.seq, name: s.name, completedAt: s.completedAt, completedByName: s.completedByName })),
      results,
      instruments: instruments.map((i) => ({ id: i.id, code: i.code, name: i.name, calibrationDueAt: i.calibrationDueAt, calibrationOverdue: !!i.calibrationDueAt && i.calibrationDueAt < today })),
      conversions: conversions.map((c) => ({ id: c.id, fromCode: c.fromUnit.code, fromSymbol: c.fromUnit.symbol, toCode: c.toUnit.code, toSymbol: c.toUnit.symbol })),
      // Suggestions follow the outcome so far; everything else stays selectable.
      remarkOptions: templates.map((r) => ({ id: r.id, code: r.code, text: r.text, outcome: r.outcome, suggested: r.outcome === outcome || (r.outcome === 'ANY' && r.testId === t.testId) })),
      assignedToName: t.assignedTo?.name ?? null,
      submittedAt: t.submittedAt,
      approvedAt: t.approvedAt,
      approvedByName: approver?.name ?? null,
      outcome,
    };
  }

  // ---------------------------------------------------------------- work
  private async loadForWork(tx: Tx, id: string, version: number) {
    const t = await tx.sampleTest.findFirst({ where: { id, deletedAt: null }, include: detailInclude });
    if (!t) throw notFound('Test');
    this.assertAssignee(t);
    this.assertJobActive(t);
    if (t.version !== version) throw conflict();
    return t;
  }

  private bump(tx: Tx, id: string, version: number, data: Prisma.SampleTestUncheckedUpdateManyInput) {
    return tx.sampleTest.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } }).then(({ count }) => {
      if (count !== 1) throw conflict();
    });
  }

  async start(id: string, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const t = await this.loadForWork(tx, id, version);
      assertTransition(TEST, t.status, 'IN_PROGRESS');
      await this.bump(tx, id, version, { status: 'IN_PROGRESS', startedAt: t.startedAt ?? new Date(), conductedById: actorId(), conductedByName: currentUser()!.name });
      await this.audit.status(tx, { entity: 'SampleTest', entityId: id, from: t.status, to: 'IN_PROGRESS', jobId: t.sample.jobId });
      await this.jobs.syncStatus(tx, t.sample.jobId);
    });
    return this.detail(id);
  }

  /** Stages complete in order; the person and time are recorded. */
  async completeStage(id: string, seq: number, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const t = await this.loadForWork(tx, id, version);
      if (t.status !== 'IN_PROGRESS') throw rule('NOT_IN_PROGRESS', 'Start the test before completing stages');
      const stage = t.stages.find((s) => s.seq === seq);
      if (!stage) throw notFound('Stage');
      if (stage.completedAt) throw rule('STAGE_DONE', 'This stage is already complete');
      if (t.stages.some((s) => s.seq < seq && !s.completedAt)) throw rule('STAGE_ORDER', 'Complete the earlier stages first');
      await tx.sampleTestStage.update({ where: { id: stage.id }, data: { completedAt: new Date(), completedById: actorId(), completedByName: currentUser()!.name } });
      const next = t.stages.find((s) => s.seq > seq && !s.completedAt);
      await this.bump(tx, id, version, { currentStage: next?.name ?? ALL_STAGES_DONE });
      await this.audit.record({ action: 'SampleTest.stage', entity: 'SampleTest', entityId: id, after: { stage: stage.name } }, tx);
    });
    return this.detail(id);
  }

  private async assertInstrument(tx: Tx, instrumentId: string | null) {
    if (!instrumentId) return;
    const i = await tx.instrument.findFirst({ where: { id: instrumentId, isActive: true, deletedAt: null } });
    if (!i) throw badRequest('That instrument is not available', [{ field: 'instrumentId', message: 'Not available' }]);
    if (i.calibrationDueAt && i.calibrationDueAt < istToday() && (await this.settings.get('controls.blockOverdueInstruments', tx))) {
      throw rule('INSTRUMENT_OVERDUE', `${i.name} is past its calibration due date and cannot be used`);
    }
  }

  /** Writes values and recalculates. Used for autosaved drafts too, so previews come from the server. */
  private async persistValues(tx: Tx, t: DetailRow, values: Map<string, string | null>) {
    const params = await this.paramRows(tx, t.results);
    const entered: Record<string, string | null> = {};
    for (const r of t.results) {
      entered[r.parameterId] = values.has(r.parameterId) ? values.get(r.parameterId)! : enteredValue(r);
    }
    const computed = computeResults(params, entered);
    const now = new Date();
    const before = new Map(t.results.map((r) => [r.parameterId, r]));
    const changes: { parameter: string; from: string | null; to: string | null }[] = [];
    for (const c of computed) {
      const old = before.get(c.parameterId)!;
      const was = enteredValue(old);
      const now_ = c.numericValue !== null ? `${c.qualifier ?? ''}${c.numericValue}` : c.textValue;
      const changed = (was === null ? null : normaliseValue(was, old.decimals)) !== now_;
      if (changed) changes.push({ parameter: old.code, from: was, to: now_ });
      await tx.parameterResult.update({
        where: { sampleTestId_parameterId: { sampleTestId: t.id, parameterId: c.parameterId } },
        // "Entered by" follows the value: it moves only when this value changed.
        data: {
          numericValue: c.numericValue,
          qualifier: c.qualifier,
          textValue: c.textValue,
          passPrimary: c.passPrimary,
          passDual: c.passDual,
          ...(changed ? { enteredById: actorId(), enteredAt: now } : {}),
        },
      });
    }
    // One audit entry per save listing each changed value, so every result's history (who, when, from what) is kept.
    if (changes.length)
      await this.audit.record(
        {
          action: 'SampleTest.results',
          entity: 'SampleTest',
          entityId: t.id,
          before: Object.fromEntries(changes.map((c) => [c.parameter, c.from])),
          after: Object.fromEntries(changes.map((c) => [c.parameter, c.to])),
        },
        tx,
      );
    return computed;
  }

  async saveResults(id: string, dto: SaveResultsDto) {
    await this.prisma.$transaction(async (tx) => {
      const t = await this.loadForWork(tx, id, dto.version);
      if (t.status !== 'IN_PROGRESS') throw rule('LOCKED', 'Results can only be changed while the test is in progress');
      if (dto.values) {
        const known = new Set(t.results.map((r) => r.parameterId));
        for (const v of dto.values) if (!known.has(v.parameterId)) throw badRequest('Unknown parameter', [{ field: 'values', message: 'Unknown parameter' }]);
        const results = t.results.filter((r) => r.kind !== 'CALCULATED');
        const entered = new Map(dto.values.filter((v) => results.some((r) => r.parameterId === v.parameterId)).map((v) => [v.parameterId, v.value ?? null]));
        const computed = await this.persistValues(tx, t, entered);
        // A bad entry is refused, not stored as blank. Calculated rows only ever "wait" here.
        const bad = computed.filter((c) => c.error && entered.has(c.parameterId));
        if (bad.length) {
          const names = new Map(t.results.map((r) => [r.parameterId, r.name]));
          throw new AppError(
            'RESULT_INVALID',
            400,
            bad.map((b) => `${names.get(b.parameterId)}: ${b.error}`).join('; '),
            bad.map((b) => ({ field: b.parameterId, message: b.error! })),
          );
        }
      }
      if (dto.instrumentId !== undefined) await this.assertInstrument(tx, dto.instrumentId);
      await this.bump(tx, id, dto.version, {
        ...(dto.instrumentId !== undefined ? { instrumentId: dto.instrumentId } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
        ...(dto.observations !== undefined ? { observations: dto.observations } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      });
    });
    return this.detail(id);
  }

  async submit(id: string, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const t = await this.loadForWork(tx, id, version);
      assertTransition(TEST, t.status, 'RESULTS_SUBMITTED');
      if (t.stages.some((s) => !s.completedAt)) throw rule('STAGES_INCOMPLETE', 'Complete every stage before submitting');
      await this.assertInstrument(tx, t.instrumentId);
      const computed = await this.persistValues(tx, t, new Map());
      const byId = new Map(t.results.map((r) => [r.parameterId, r]));
      const missing = computed.filter((c) => c.numericValue === null && c.textValue === null).map((c) => byId.get(c.parameterId)!.name);
      if (missing.length)
        throw new AppError(
          'RESULTS_MISSING',
          422,
          `Enter a result for: ${missing.join(', ')}`,
          missing.map((m) => ({ field: m, message: 'Required' })),
        );
      const errors = computed.filter((c) => c.error);
      if (errors.length) throw rule('RESULTS_INVALID', errors.map((e) => `${byId.get(e.parameterId)!.name}: ${e.error}`).join('; '));
      // Each calculated result records exactly which formula version produced it.
      for (const c of computed) {
        if (!c.calculation) continue;
        await tx.calculationRecord.create({
          data: {
            parameterResultId: byId.get(c.parameterId)!.id,
            formulaVersionId: c.calculation.formulaVersionId,
            inputs: c.calculation.inputs,
            working: c.calculation.working,
            result: c.calculation.result,
            createdById: actorId(),
          },
        });
      }
      await this.bump(tx, id, version, {
        status: 'RESULTS_SUBMITTED',
        submittedAt: new Date(),
        submittedById: actorId(),
        conductedById: actorId(),
        conductedByName: currentUser()!.name,
        rejectionReason: null,
      });
      await this.audit.status(tx, { entity: 'SampleTest', entityId: id, from: t.status, to: 'RESULTS_SUBMITTED', jobId: t.sample.jobId });
      await this.notify?.(tx, { type: 'RESULTS_SUBMITTED', sampleTestId: id });
    });
    return this.detail(id);
  }

  async hold(id: string, version: number, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.sampleTest.findFirst({ where: { id, deletedAt: null }, include: detailInclude });
      if (!t) throw notFound('Test');
      this.assertHoldAccess(t);
      assertTransition(TEST, t.status, 'ON_HOLD', reason);
      await this.bump(tx, id, version, { status: 'ON_HOLD', statusBeforeHold: t.status, holdReason: reason });
      await this.audit.status(tx, { entity: 'SampleTest', entityId: id, from: t.status, to: 'ON_HOLD', reason, jobId: t.sample.jobId });
    });
    return this.detail(id);
  }

  async release(id: string, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.sampleTest.findFirst({ where: { id, deletedAt: null }, include: detailInclude });
      if (!t) throw notFound('Test');
      this.assertHoldAccess(t);
      this.assertJobActive(t);
      if (t.status !== 'ON_HOLD' || !t.statusBeforeHold) throw rule('NOT_ON_HOLD', 'This test is not on hold');
      assertTransition(TEST, 'ON_HOLD', t.statusBeforeHold);
      await this.bump(tx, id, version, { status: t.statusBeforeHold, statusBeforeHold: null, holdReason: null });
      await this.audit.status(tx, { entity: 'SampleTest', entityId: id, from: 'ON_HOLD', to: t.statusBeforeHold, jobId: t.sample.jobId });
    });
    return this.detail(id);
  }

  /** Technicians hold only their own tests; supervisors with tests.hold can hold any. */
  private assertHoldAccess(t: { assignedToId: string | null }) {
    if (can('tests.hold')) return;
    this.assertAssignee(t);
  }

  // ---------------------------------------------------------------- approvals
  async approvalQueue(q: ApprovalQuery) {
    const where: Prisma.SampleTestWhereInput = {
      deletedAt: null,
      status: 'RESULTS_SUBMITTED',
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.q
        ? {
            OR: [
              { testName: { contains: q.q, mode: 'insensitive' } },
              { sample: { sampleNo: { contains: q.q, mode: 'insensitive' } } },
              { sample: { job: { jobNo: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sampleTest.findMany({ where, include: detailInclude, orderBy: [{ urgent: 'desc' }, orderBy(q, ['dueDate', 'submittedAt', 'testName'], 'submittedAt', 'asc')], ...skipTake(q) }),
      this.prisma.sampleTest.count({ where }),
    ]);
    const me = actorId();
    // One parameter lookup for the whole page, not one per test; each row's slice keeps its own limits.
    const allParams = await this.paramRows(
      this.prisma,
      rows.flatMap((t) => t.results),
    );
    let offset = 0;
    const data = await Promise.all(
      rows.map(async (t) => {
        const params = allParams.slice(offset, (offset += t.results.length));
        const results = this.resultView(t, params);
        return {
          id: t.id,
          testCode: t.testCode,
          testName: t.testName,
          methodName: t.methodName,
          sampleNo: t.sample.sampleNo,
          jobNo: t.sample.job.jobNo,
          urgent: t.urgent,
          dueDate: t.dueDate,
          submittedAt: t.submittedAt,
          conductedByName: t.conductedByName,
          outcome: overallOutcome(results),
          version: t.version,
          ownResult: t.conductedById === me || t.submittedById === me,
          results,
        };
      }),
    );
    return toPage(data, total, q);
  }

  /** Separation of duties: nobody approves their own results, unless an Admin has relaxed the control. */
  private async assertNotOwnResult(tx: Tx, t: { conductedById: string | null; submittedById: string | null }) {
    const me = actorId();
    if ((t.conductedById === me || t.submittedById === me) && !(await this.settings.get('controls.allowSelfApproval', tx))) {
      throw new AppError('SELF_APPROVAL', 403, 'You cannot approve results you entered');
    }
  }

  private async approveIn(tx: Tx, id: string, version: number) {
    const t = await tx.sampleTest.findFirst({ where: { id, deletedAt: null }, include: { sample: { select: { jobId: true, id: true } } } });
    if (!t) throw notFound('Test');
    // Before counting what is left open on the sample, so two approvals of its last tests can't both miss it.
    await this.jobs.lockJob(tx, t.sample.jobId);
    assertTransition(TEST, t.status, 'APPROVED');
    await this.assertNotOwnResult(tx, t);
    await this.bump(tx, id, version, { status: 'APPROVED', approvedAt: new Date(), approvedById: actorId(), rejectionReason: null });
    await this.audit.status(tx, { entity: 'SampleTest', entityId: id, from: t.status, to: 'APPROVED', jobId: t.sample.jobId });
    await this.jobs.syncStatus(tx, t.sample.jobId);
    const open = await tx.sampleTest.count({ where: { sampleId: t.sample.id, deletedAt: null, status: { notIn: ['APPROVED', 'CANCELLED'] } } });
    if (open === 0) await this.onAllApproved?.(tx, t.sample.id);
  }

  async approve(id: string, version: number) {
    await this.prisma.$transaction((tx) => this.approveIn(tx, id, version));
    return this.detail(id);
  }

  /** Each item stands alone: one failure does not undo the rest. */
  async bulkApprove(items: { id: string; version: number }[]) {
    const approved: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const item of items) {
      try {
        await this.prisma.$transaction((tx) => this.approveIn(tx, item.id, item.version));
        approved.push(item.id);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        failed.push({ id: item.id, message: e.message });
      }
    }
    return { approved, failed };
  }

  /** Back to the analyst, with the reason shown on their screen. */
  async reject(id: string, version: number, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.sampleTest.findFirst({ where: { id, deletedAt: null }, include: { sample: { select: { jobId: true } } } });
      if (!t) throw notFound('Test');
      assertTransition(TEST, t.status, 'IN_PROGRESS', reason);
      await this.bump(tx, id, version, { status: 'IN_PROGRESS', rejectionReason: reason, submittedAt: null });
      await this.audit.status(tx, { entity: 'SampleTest', entityId: id, from: t.status, to: 'IN_PROGRESS', reason, jobId: t.sample.jobId, meta: { rejected: true } });
      await this.notify?.(tx, { type: 'TEST_REJECTED', sampleTestId: id, reason });
    });
    return this.detail(id);
  }

  async history(id: string) {
    const t = await this.prisma.sampleTest.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw notFound('Test');
    this.assertCanRead(t);
    const rows = await this.prisma.auditLog.findMany({ where: { entity: 'SampleTest', entityId: id }, orderBy: { at: 'desc' }, take: 200 });
    return rows.map((r) => ({ id: r.id.toString(), at: r.at, userName: r.userName, action: r.action, before: r.before, after: r.after, reason: r.reason }));
  }
}
