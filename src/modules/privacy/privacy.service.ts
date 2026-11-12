import { Injectable } from '@nestjs/common';
import { currentUser } from '../../common/context.js';
import { badRequest, conflict, notFound, requireRecentAuth, rule } from '../../common/errors.js';
import { istToday } from '../../common/india.js';
import { AuditService } from '../../core/audit.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { CreateBreachDto, CreateDataRequestDto, ResolveDataRequestDto, UpdateBreachDto } from './privacy.dto.js';

const day = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
// TODO(product-decision): the detailed breach report is due to the Data Protection Board within 72 hours (DPDP Rules 2025, rule 7).
const BOARD_REPORT_HOURS = 72;

/**
 * The Digital Personal Data Protection Act 2023 for a testing laboratory: the people whose data it holds are its
 * customers' contacts and its own staff. Requests about their data are tracked to an answer by a deadline; a breach
 * is logged with when the Board and the people affected were told.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  private requestDto<T extends { status: string; dueOn: Date }>(r: T) {
    return { ...r, overdue: r.status === 'OPEN' && r.dueOn < istToday() };
  }

  async requests() {
    const rows = await this.prisma.dataRequest.findMany({ orderBy: [{ status: 'asc' }, { dueOn: 'asc' }], take: 500 });
    return rows.map((r) => this.requestDto(r));
  }

  async createRequest(dto: CreateDataRequestDto) {
    const receivedOn = day(dto.receivedOn);
    if (receivedOn > istToday()) throw badRequest('That date is in the future', [{ field: 'receivedOn', message: 'In the future' }]);
    const days = await this.settings.get('privacy.responseDays');
    const r = await this.prisma.dataRequest.create({
      data: { kind: dto.kind, requesterName: dto.requesterName.trim(), requesterEmail: dto.requesterEmail.trim().toLowerCase(), details: dto.details.trim(), receivedOn, dueOn: new Date(receivedOn.getTime() + days * 86_400_000), createdById: currentUser()?.id ?? null },
    });
    await this.audit.record({ action: 'privacy.request.received', entity: 'DataRequest', entityId: r.id, after: { kind: r.kind, dueOn: r.dueOn } });
    await this.notifications.notifyHolders(this.prisma, 'privacy.manage', { type: 'PRIVACY_REQUEST', title: `Privacy request: ${r.kind.toLowerCase().replace('_', ' ')}`, body: `From ${r.requesterName}. Answer by ${r.dueOn.toISOString().slice(0, 10)}.`, link: '/admin?tab=privacy' });
    return this.requestDto(r);
  }

  async resolveRequest(id: string, dto: ResolveDataRequestDto) {
    if (!dto.resolution.trim()) throw badRequest('Say what was done', [{ field: 'resolution', message: 'Required' }]);
    const r = await this.prisma.dataRequest.findUnique({ where: { id } });
    if (!r) throw notFound('Request');
    if (r.status !== 'OPEN') throw rule('ALREADY_ANSWERED', 'This request has already been answered');
    const { count } = await this.prisma.dataRequest.updateMany({ where: { id, version: dto.version }, data: { status: dto.status, resolution: dto.resolution.trim(), resolvedAt: new Date(), resolvedByName: currentUser()?.name ?? null, version: { increment: 1 } } });
    if (count !== 1) throw conflict();
    await this.audit.record({ action: `privacy.request.${dto.status.toLowerCase()}`, entity: 'DataRequest', entityId: id, after: { resolution: dto.resolution } });
    return this.requestDto((await this.prisma.dataRequest.findUniqueOrThrow({ where: { id } })));
  }

  /** Where this email address appears, for answering an access request. */
  async personalData(email: string) {
    const e = email.trim().toLowerCase();
    const [contacts, users, emails, jobs] = await Promise.all([
      this.prisma.customerContact.findMany({ where: { email: { equals: e, mode: 'insensitive' }, deletedAt: null }, include: { customer: { select: { name: true } } } }),
      this.prisma.user.findMany({ where: { email: e, deletedAt: null }, select: { name: true, email: true, phone: true, designation: true } }),
      this.prisma.emailLog.count({ where: { OR: [{ toAddress: { contains: e, mode: 'insensitive' } }, { ccAddress: { contains: e, mode: 'insensitive' } }] } }),
      this.prisma.job.findMany({ where: { contactEmail: { equals: e, mode: 'insensitive' }, deletedAt: null }, select: { jobNo: true, kindAttention: true, contactPhone: true } }),
    ]);
    const items = [
      ...contacts.map((c) => ({ place: 'Customer contact', record: c.customer.name, details: [c.name, c.email, c.phone, c.designation].filter(Boolean).join(', '), erasable: true })),
      ...users.map((u) => ({ place: 'Staff account', record: u.name, details: [u.name, u.email, u.phone, u.designation].filter(Boolean).join(', '), erasable: false })),
      ...jobs.map((j) => ({ place: 'Job (contact on booking)', record: j.jobNo, details: [j.kindAttention, e, j.contactPhone].filter(Boolean).join(', '), erasable: false })),
      ...(emails ? [{ place: 'Emails sent', record: `${emails} email(s)`, details: e, erasable: false }] : []),
    ];
    return { email: e, items };
  }

  /**
   * Erasure: removes the name, email and phone from customer contacts with this address. Jobs, reports, invoices and
   * the email log keep what they recorded, as tax and accreditation rules require them to be kept unchanged.
   */
  async erase(requestId: string) {
    requireRecentAuth();
    const r = await this.prisma.dataRequest.findUnique({ where: { id: requestId } });
    if (!r) throw notFound('Request');
    if (r.kind !== 'ERASURE' && r.kind !== 'CONSENT_WITHDRAWAL') throw rule('NOT_ERASURE', 'Only an erasure request or a withdrawal of consent can erase data');
    if (r.status !== 'OPEN') throw rule('ALREADY_ANSWERED', 'This request has already been answered');
    const contacts = await this.prisma.customerContact.findMany({ where: { email: { equals: r.requesterEmail, mode: 'insensitive' }, deletedAt: null }, select: { id: true, customerId: true } });
    await this.prisma.$transaction(async (tx) => {
      for (const c of contacts) await tx.customerContact.update({ where: { id: c.id }, data: { name: 'Erased on request', email: null, phone: null, designation: null, isPrimary: false } });
      await this.audit.record({ action: 'privacy.erased', entity: 'DataRequest', entityId: requestId, after: { contacts: contacts.length, customers: [...new Set(contacts.map((c) => c.customerId))] } }, tx);
    });
    return { contacts: contacts.length };
  }

  private breachDto<T extends { detectedAt: Date }>(b: T) {
    return { ...b, boardReportDueAt: new Date(b.detectedAt.getTime() + BOARD_REPORT_HOURS * 3_600_000) };
  }

  async breaches() {
    return (await this.prisma.breachIncident.findMany({ orderBy: { detectedAt: 'desc' }, take: 200 })).map((b) => this.breachDto(b));
  }

  async createBreach(dto: CreateBreachDto) {
    const detectedAt = new Date(dto.detectedAt);
    if (detectedAt.getTime() > Date.now() + 60_000) throw badRequest('That time is in the future', [{ field: 'detectedAt', message: 'In the future' }]);
    const me = currentUser();
    const b = await this.prisma.breachIncident.create({ data: { detectedAt, description: dto.description.trim(), dataAffected: dto.dataAffected.trim(), peopleAffected: dto.peopleAffected ?? null, containment: dto.containment?.trim() || null, createdById: me?.id ?? null, createdByName: me?.name ?? null } });
    await this.audit.record({ action: 'privacy.breach.logged', entity: 'BreachIncident', entityId: b.id, after: { detectedAt, dataAffected: b.dataAffected } });
    await this.notifications.notifyHolders(this.prisma, 'privacy.manage', { type: 'SECURITY_ALERT', title: 'A personal data breach was logged', body: 'The Data Protection Board and the people affected must be told without delay; the detailed report is due within 72 hours.', link: '/admin?tab=privacy' });
    return this.breachDto(b);
  }

  async updateBreach(id: string, dto: UpdateBreachDto) {
    const b = await this.prisma.breachIncident.findUnique({ where: { id } });
    if (!b) throw notFound('Breach');
    const when = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);
    const { count } = await this.prisma.breachIncident.updateMany({
      where: { id, version: dto.version },
      data: {
        ...(dto.containment !== undefined ? { containment: dto.containment?.trim() || null } : {}),
        ...(dto.peopleAffected !== undefined ? { peopleAffected: dto.peopleAffected } : {}),
        ...(dto.reportedToBoardAt !== undefined ? { reportedToBoardAt: when(dto.reportedToBoardAt) } : {}),
        ...(dto.notifiedPeopleAt !== undefined ? { notifiedPeopleAt: when(dto.notifiedPeopleAt) } : {}),
        ...(dto.closedAt !== undefined ? { closedAt: when(dto.closedAt) } : {}),
        version: { increment: 1 },
      },
    });
    if (count !== 1) throw conflict();
    await this.audit.record({ action: 'privacy.breach.updated', entity: 'BreachIncident', entityId: id, after: dto });
    return this.breachDto(await this.prisma.breachIncident.findUniqueOrThrow({ where: { id } }));
  }
}
