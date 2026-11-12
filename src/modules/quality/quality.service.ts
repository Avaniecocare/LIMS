import { Injectable, OnModuleInit } from '@nestjs/common';
import { actorId, currentUser } from '../../common/context.js';
import { badRequest, conflict, notFound, rule } from '../../common/errors.js';
import { formatDate, istToday } from '../../common/india.js';
import { AuditService } from '../../core/audit.service.js';
import { ModulesService } from '../../core/modules.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import type { NcStatus } from '../../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import type { AuthorisationQuery, CreateAuthorisationDto, CreateNcDto, CreateTrainingDto, EquipmentScheduleDto, NcQuery, RecordEquipmentEventDto, UpdateNcDto } from './quality.dto.js';

const day = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
export function addMonths(d: Date, months: number): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
  // 31 January + 1 month is the last day of February, not 3 March.
  if (r.getUTCDate() !== d.getUTCDate()) r.setUTCDate(0);
  return r;
}

type Due = 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NOT_SCHEDULED';
export function dueStatus(dates: (Date | null)[], today: Date, warnDays: number): Due {
  const set = dates.filter((d): d is Date => !!d);
  if (!set.length) return 'NOT_SCHEDULED';
  const soonest = Math.min(...set.map((d) => d.getTime()));
  if (soonest < today.getTime()) return 'OVERDUE';
  if (soonest <= today.getTime() + warnDays * 86_400_000) return 'DUE_SOON';
  return 'OK';
}

/** What each step of a non-conformance needs before it can move on. */
const NC_FLOW: Record<NcStatus, NcStatus[]> = { OPEN: ['ACTION'], ACTION: ['OPEN', 'VERIFICATION'], VERIFICATION: ['ACTION', 'CLOSED'], CLOSED: ['ACTION'] };

/**
 * Quality management for ISO/IEC 17025: the equipment log (calibration, checks, maintenance), who is authorised to
 * do which test and their training, and the non-conformance and corrective action register.
 */
@Injectable()
export class QualityService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
    private readonly scheduler: SchedulerService,
    private readonly modules: ModulesService,
  ) {}

  onModuleInit() {
    // Each morning, the people who run quality hear about equipment that is due or overdue.
    this.scheduler.register({ name: 'equipment-due', pattern: '0 8 * * *', run: async () => ((await this.modules.isOn('quality')) ? this.equipmentReminders() : 0) });
  }

  // ---------------------------------------------------------------- equipment

  async equipment() {
    const [rows, warn] = await Promise.all([
      this.prisma.instrument.findMany({ where: { deletedAt: null, isActive: true }, include: { department: { select: { name: true } } }, orderBy: { code: 'asc' } }),
      this.settings.get('quality.dueWarningDays'),
    ]);
    const today = istToday();
    const order: Record<Due, number> = { OVERDUE: 0, DUE_SOON: 1, OK: 2, NOT_SCHEDULED: 3 };
    return rows
      .map((r) => ({
        id: r.id, code: r.code, name: r.name, departmentName: r.department?.name ?? null,
        lastCalibratedAt: r.lastCalibratedAt, calibrationDueAt: r.calibrationDueAt, calibrationIntervalMonths: r.calibrationIntervalMonths,
        lastMaintainedAt: r.lastMaintainedAt, maintenanceDueAt: r.maintenanceDueAt, maintenanceIntervalMonths: r.maintenanceIntervalMonths,
        status: dueStatus([r.calibrationDueAt, r.maintenanceDueAt], today, warn),
        version: r.version,
      }))
      .sort((a, b) => order[a.status] - order[b.status] || a.code.localeCompare(b.code));
  }

  async events(instrumentId: string) {
    await this.instrument(instrumentId);
    return this.prisma.equipmentEvent.findMany({ where: { instrumentId }, orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }] });
  }

  private async instrument(id: string, tx: Tx | PrismaService = this.prisma) {
    const i = await tx.instrument.findFirst({ where: { id, deletedAt: null } });
    if (!i) throw notFound('Instrument');
    return i;
  }

  /** Records a calibration, check, maintenance or repair. A calibration or maintenance moves the next due date. */
  async recordEvent(instrumentId: string, dto: RecordEquipmentEventDto) {
    const performedOn = day(dto.performedOn);
    if (performedOn > istToday()) throw badRequest('That date is in the future', [{ field: 'performedOn', message: 'In the future' }]);
    const nextDue = dto.nextDueOn ? day(dto.nextDueOn) : null;
    if (nextDue && nextDue <= performedOn) throw badRequest('The next due date must be after this one', [{ field: 'nextDueOn', message: 'Before or on the date done' }]);
    return this.prisma.$transaction(async (tx) => {
      const i = await this.instrument(instrumentId, tx);
      const event = await tx.equipmentEvent.create({
        data: { instrumentId, kind: dto.kind, performedOn, performedBy: dto.performedBy.trim(), outcome: dto.outcome, certificateNo: dto.certificateNo?.trim() || null, certificateFileId: dto.certificateFileId ?? null, nextDueOn: nextDue, notes: dto.notes?.trim() || null, createdById: actorId() },
      });
      const data: Prisma.InstrumentUpdateInput = {};
      if (dto.kind === 'CALIBRATION' && dto.outcome !== 'FAIL') {
        data.lastCalibratedAt = performedOn;
        data.calibrationDueAt = nextDue ?? (i.calibrationIntervalMonths ? addMonths(performedOn, i.calibrationIntervalMonths) : i.calibrationDueAt);
        if (dto.certificateFileId) data.certificateFileId = dto.certificateFileId;
      }
      if (dto.kind === 'MAINTENANCE' && dto.outcome !== 'FAIL') {
        data.lastMaintainedAt = performedOn;
        data.maintenanceDueAt = nextDue ?? (i.maintenanceIntervalMonths ? addMonths(performedOn, i.maintenanceIntervalMonths) : i.maintenanceDueAt);
      }
      // A failed calibration or a breakdown puts the instrument out of use until it passes again.
      if ((dto.kind === 'CALIBRATION' && dto.outcome === 'FAIL') || dto.kind === 'BREAKDOWN') data.calibrationDueAt = performedOn;
      if (Object.keys(data).length) await tx.instrument.update({ where: { id: instrumentId }, data: { ...data, version: { increment: 1 } } });
      await this.audit.record({ action: `equipment.${dto.kind.toLowerCase()}`, entity: 'Instrument', entityId: instrumentId, after: { ...dto, eventId: event.id } }, tx);
      return event;
    });
  }

  async schedule(instrumentId: string, dto: EquipmentScheduleDto) {
    const i = await this.instrument(instrumentId);
    if (i.version !== dto.version) throw conflict();
    await this.prisma.instrument.update({
      where: { id: instrumentId },
      data: {
        ...(dto.calibrationIntervalMonths !== undefined ? { calibrationIntervalMonths: dto.calibrationIntervalMonths } : {}),
        ...(dto.maintenanceIntervalMonths !== undefined ? { maintenanceIntervalMonths: dto.maintenanceIntervalMonths } : {}),
        ...(dto.maintenanceDueAt !== undefined ? { maintenanceDueAt: dto.maintenanceDueAt ? day(dto.maintenanceDueAt) : null } : {}),
        version: { increment: 1 },
      },
    });
    await this.audit.record({ action: 'equipment.schedule', entity: 'Instrument', entityId: instrumentId, before: { calibrationIntervalMonths: i.calibrationIntervalMonths, maintenanceIntervalMonths: i.maintenanceIntervalMonths, maintenanceDueAt: i.maintenanceDueAt }, after: dto });
  }

  async equipmentReminders(): Promise<number> {
    const due = (await this.equipment()).filter((e) => e.status === 'OVERDUE' || e.status === 'DUE_SOON');
    if (!due.length) return 0;
    const overdue = due.filter((e) => e.status === 'OVERDUE').length;
    const today = formatDate(istToday());
    return this.notifications.notifyHolders(this.prisma, 'quality.manage', {
      type: 'EQUIPMENT_DUE',
      title: overdue ? `${overdue} instrument(s) overdue for calibration or maintenance` : `${due.length} instrument(s) due for calibration or maintenance soon`,
      body: due.slice(0, 8).map((e) => `${e.code} ${e.name}`).join(', '),
      link: '/quality?tab=equipment',
      dedupeKey: `equipment-due:${today}`,
    });
  }

  // ---------------------------------------------------------------- competency

  private state(a: { withdrawnAt: Date | null; validUntil: Date | null }, today = istToday()) {
    return a.withdrawnAt ? ('WITHDRAWN' as const) : a.validUntil && a.validUntil < today ? ('EXPIRED' as const) : ('ACTIVE' as const);
  }

  async authorisations(q: AuthorisationQuery) {
    const rows = await this.prisma.staffAuthorisation.findMany({ where: { ...(q.userId ? { userId: q.userId } : {}), ...(q.testId ? { testId: q.testId } : {}) }, orderBy: { authorisedOn: 'desc' } });
    const [users, tests] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } }),
      this.prisma.testMaster.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.testId))] } }, select: { id: true, code: true, name: true } }),
    ]);
    return rows.map((r) => {
      const t = tests.find((x) => x.id === r.testId);
      return { id: r.id, userId: r.userId, userName: users.find((u) => u.id === r.userId)?.name ?? '—', testId: r.testId, testCode: t?.code ?? '—', testName: t?.name ?? '—', authorisedOn: r.authorisedOn, validUntil: r.validUntil, authorisedByName: r.authorisedByName, evidence: r.evidence, evidenceFileId: r.evidenceFileId, state: this.state(r), withdrawnReason: r.withdrawnReason };
    });
  }

  async authorise(dto: CreateAuthorisationDto) {
    const [user, test] = await Promise.all([this.prisma.user.findFirst({ where: { id: dto.userId, deletedAt: null } }), this.prisma.testMaster.findFirst({ where: { id: dto.testId, deletedAt: null } })]);
    if (!user) throw notFound('User');
    if (!test) throw notFound('Test');
    const from = day(dto.authorisedOn);
    const until = dto.validUntil ? day(dto.validUntil) : null;
    if (until && until <= from) throw badRequest('Valid until must be after the date authorised', [{ field: 'validUntil', message: 'Before the start' }]);
    const active = await this.prisma.staffAuthorisation.findFirst({ where: { userId: dto.userId, testId: dto.testId, withdrawnAt: null, OR: [{ validUntil: null }, { validUntil: { gte: istToday() } }] } });
    if (active) throw rule('ALREADY_AUTHORISED', `${user.name} is already authorised for ${test.name}`);
    const me = currentUser();
    const row = await this.prisma.staffAuthorisation.create({ data: { userId: dto.userId, testId: dto.testId, authorisedOn: from, validUntil: until, authorisedById: me?.id ?? null, authorisedByName: me?.name ?? null, evidence: dto.evidence?.trim() || null, evidenceFileId: dto.evidenceFileId ?? null } });
    await this.audit.record({ action: 'competency.authorised', entity: 'User', entityId: dto.userId, after: { testId: dto.testId, testName: test.name, authorisedOn: dto.authorisedOn, validUntil: dto.validUntil ?? null } });
    return row;
  }

  async withdraw(id: string, reason: string) {
    if (!reason.trim()) throw badRequest('Say why', [{ field: 'reason', message: 'Required' }]);
    const a = await this.prisma.staffAuthorisation.findUnique({ where: { id } });
    if (!a) throw notFound('Authorisation');
    if (a.withdrawnAt) throw rule('ALREADY_WITHDRAWN', 'This authorisation was already withdrawn');
    await this.prisma.staffAuthorisation.update({ where: { id }, data: { withdrawnAt: new Date(), withdrawnReason: reason.trim() } });
    await this.audit.record({ action: 'competency.withdrawn', entity: 'User', entityId: a.userId, after: { testId: a.testId, reason } });
  }

  /** Which of these tests the person is not currently authorised for. */
  async missingAuthorisations(userId: string, testIds: string[], tx: Tx | PrismaService = this.prisma) {
    const active = await tx.staffAuthorisation.findMany({ where: { userId, testId: { in: testIds }, withdrawnAt: null, OR: [{ validUntil: null }, { validUntil: { gte: istToday() } }] }, select: { testId: true } });
    const ok = new Set(active.map((a) => a.testId));
    return [...new Set(testIds)].filter((t) => !ok.has(t));
  }

  async training(userId?: string) {
    const rows = await this.prisma.trainingRecord.findMany({ where: userId ? { userId } : {}, orderBy: { trainedOn: 'desc' }, take: 500 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } });
    return rows.map((r) => ({ id: r.id, userId: r.userId, userName: users.find((u) => u.id === r.userId)?.name ?? '—', title: r.title, trainedOn: r.trainedOn, trainer: r.trainer, hours: r.hours?.toString() ?? null, notes: r.notes, evidenceFileId: r.evidenceFileId }));
  }

  async addTraining(dto: CreateTrainingDto) {
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, deletedAt: null } });
    if (!user) throw notFound('User');
    const trainedOn = day(dto.trainedOn);
    if (trainedOn > istToday()) throw badRequest('That date is in the future', [{ field: 'trainedOn', message: 'In the future' }]);
    const row = await this.prisma.trainingRecord.create({ data: { userId: dto.userId, title: dto.title.trim(), trainedOn, trainer: dto.trainer?.trim() || null, hours: dto.hours ?? null, notes: dto.notes?.trim() || null, evidenceFileId: dto.evidenceFileId ?? null, createdById: actorId() } });
    await this.audit.record({ action: 'training.recorded', entity: 'User', entityId: dto.userId, after: { title: dto.title, trainedOn: dto.trainedOn } });
    return row;
  }

  // ---------------------------------------------------------------- non-conformance and CAPA

  private ncDto(n: Prisma.NonConformanceGetPayload<object>, today = istToday()) {
    return { ...n, overdue: n.status !== 'CLOSED' && !!n.dueOn && n.dueOn < today };
  }

  async ncList(q: NcQuery) {
    const rows = await this.prisma.nonConformance.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.q ? { OR: [{ ncNo: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((n) => this.ncDto(n));
  }

  /** The non-conformances this person raised, newest first, so they can follow what happened to them. */
  async ncMine() {
    const rows = await this.prisma.nonConformance.findMany({ where: { createdById: actorId() ?? '' }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((n) => this.ncDto(n));
  }

  async ncGet(id: string) {
    const n = await this.prisma.nonConformance.findUnique({ where: { id } });
    if (!n) throw notFound('Non-conformance');
    return this.ncDto(n);
  }

  private async ownerName(ownerId: string | null | undefined) {
    if (!ownerId) return null;
    const u = await this.prisma.user.findFirst({ where: { id: ownerId, deletedAt: null, isActive: true }, select: { name: true } });
    if (!u) throw badRequest('Choose an active person as owner', [{ field: 'ownerId', message: 'Not found' }]);
    return u.name;
  }

  async ncCreate(dto: CreateNcDto) {
    const ownerName = await this.ownerName(dto.ownerId);
    const me = currentUser();
    const n = await this.prisma.$transaction(async (tx) => {
      const ncNo = await this.numbering.next(tx, 'NC');
      const row = await tx.nonConformance.create({
        data: { ncNo, source: dto.source, title: dto.title.trim(), description: dto.description.trim(), severity: dto.severity, reference: dto.reference?.trim() || null, ownerId: dto.ownerId ?? null, ownerName, dueOn: dto.dueOn ? day(dto.dueOn) : null, createdById: me?.id ?? null, createdByName: me?.name ?? null },
      });
      await this.audit.record({ action: 'nc.raised', entity: 'NonConformance', entityId: row.id, after: { ncNo, title: row.title, severity: row.severity } }, tx);
      return row;
    });
    if (n.ownerId) await this.notifications.send(this.prisma, [n.ownerId], { type: 'NC_ASSIGNED', title: `${n.ncNo}: ${n.title}`, body: `A non-conformance is assigned to you${n.dueOn ? `, due ${formatDate(n.dueOn)}` : ''}.`, link: `/quality?tab=nc&id=${n.id}` });
    return this.ncDto(n);
  }

  /**
   * Moves a non-conformance on, checking each step has what it needs: action needs a correction or root cause,
   * verification needs the corrective action, closing needs the verification, by someone other than the owner.
   */
  async ncUpdate(id: string, dto: UpdateNcDto) {
    const n = await this.prisma.nonConformance.findUnique({ where: { id } });
    if (!n) throw notFound('Non-conformance');
    if (n.version !== dto.version) throw conflict();
    const next = { ...n, ...Object.fromEntries(Object.entries(dto).filter(([k, v]) => v !== undefined && k !== 'version')) } as typeof n & { status: NcStatus };
    const ownerName = dto.ownerId !== undefined ? await this.ownerName(dto.ownerId) : n.ownerName;
    const me = currentUser();
    const data: Prisma.NonConformanceUpdateInput = {
      ...(dto.severity ? { severity: dto.severity } : {}),
      ...(dto.correction !== undefined ? { correction: dto.correction?.trim() || null } : {}),
      ...(dto.rootCause !== undefined ? { rootCause: dto.rootCause?.trim() || null } : {}),
      ...(dto.correctiveAction !== undefined ? { correctiveAction: dto.correctiveAction?.trim() || null } : {}),
      ...(dto.verification !== undefined ? { verification: dto.verification?.trim() || null } : {}),
      ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId, ownerName } : {}),
      ...(dto.dueOn !== undefined ? { dueOn: dto.dueOn ? day(dto.dueOn) : null } : {}),
      version: { increment: 1 },
    };
    if (dto.status && dto.status !== n.status) {
      if (!NC_FLOW[n.status].includes(dto.status)) throw rule('BAD_STEP', `A non-conformance cannot go from ${n.status.toLowerCase()} to ${dto.status.toLowerCase()}`);
      const has = (v: string | null | undefined) => !!v && v.trim().length > 0;
      if (dto.status === 'ACTION' && n.status === 'OPEN' && !has(next.correction) && !has(next.rootCause)) throw rule('INCOMPLETE', 'Record the correction or the root cause first');
      if (dto.status === 'VERIFICATION' && !has(next.correctiveAction)) throw rule('INCOMPLETE', 'Record the corrective action first');
      if (dto.status === 'CLOSED') {
        if (!has(next.verification)) throw rule('INCOMPLETE', 'Record how the action was verified as effective first');
        // TODO(product-decision): the owner may not verify their own corrective action.
        if (n.ownerId && n.ownerId === me?.id) throw rule('SELF_VERIFY', 'Someone other than the owner must verify and close it');
        data.verifiedByName = me?.name ?? null;
        data.closedAt = new Date();
      }
      if (n.status === 'CLOSED') data.closedAt = null;
      data.status = dto.status;
    }
    const { count } = await this.prisma.nonConformance.updateMany({ where: { id, version: dto.version }, data: data as Prisma.NonConformanceUpdateManyMutationInput });
    if (count !== 1) throw conflict();
    await this.audit.record({ action: dto.status && dto.status !== n.status ? `nc.${dto.status.toLowerCase()}` : 'nc.update', entity: 'NonConformance', entityId: id, before: { status: n.status }, after: dto });
    return this.ncGet(id);
  }

  /** Active staff, names only: for choosing an analyst to authorise or the owner of a non-conformance. */
  async people() {
    const users = await this.prisma.user.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, designation: true, roles: { select: { role: { select: { permissions: { where: { permissionCode: 'tests.work' }, select: { permissionCode: true } } } } } } }, orderBy: { name: 'asc' } });
    return users.map((u) => ({ id: u.id, name: u.name, designation: u.designation, analyst: u.roles.some((r) => r.role.permissions.length > 0) }));
  }

  async summary() {
    const today = istToday();
    const [equipment, warn, ncOpen, ncOverdue, expiring] = await Promise.all([
      this.equipment(),
      this.settings.get('quality.dueWarningDays'),
      this.prisma.nonConformance.count({ where: { status: { not: 'CLOSED' } } }),
      this.prisma.nonConformance.count({ where: { status: { not: 'CLOSED' }, dueOn: { lt: today } } }),
      Promise.resolve(0),
    ]);
    const soon = new Date(today.getTime() + warn * 86_400_000);
    const authorisationsExpiringSoon = expiring + (await this.prisma.staffAuthorisation.count({ where: { withdrawnAt: null, validUntil: { gte: today, lte: soon } } }));
    return { equipmentOverdue: equipment.filter((e) => e.status === 'OVERDUE').length, equipmentDueSoon: equipment.filter((e) => e.status === 'DUE_SOON').length, authorisationsExpiringSoon, ncOpen, ncOverdue };
  }
}
