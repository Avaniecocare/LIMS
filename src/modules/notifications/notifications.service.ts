import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { actorId } from '../../common/context.js';
import { formatDate, istToday } from '../../common/india.js';
import { skipTake, toPage } from '../../common/pagination.dto.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { MailService } from '../../core/mail.service.js';
import { Prisma, PrismaService, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { esc } from '../pdf/templates/base.js';
import { LicenceService } from '../licence/licence.service.js';
import { PlanningService } from '../planning/planning.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { TestingService } from '../testing/testing.service.js';
import type { NotificationQuery } from './notifications.dto.js';

export const NOTIFICATION_TYPES: Record<string, string> = {
  ASSIGNED: 'Tests assigned to you',
  SENT_BACK: 'Work sent back to you',
  APPROVAL_DUE: 'Approvals waiting for you',
  TAT_NEAR: 'TAT nearing',
  TAT_CROSSED: 'TAT crossed',
  QUOTATION_EXPIRING: 'Quotations expiring',
  INVOICE_OVERDUE: 'Invoices overdue',
  ACCESS_REQUEST: 'Access requests to decide',
  ACCESS_DECISION: 'Answers to your access requests',
  SECURITY_ALERT: 'Security alerts',
  EQUIPMENT_DUE: 'Equipment due for calibration or maintenance',
  NC_ASSIGNED: 'Non-conformances assigned to you',
  PRIVACY_REQUEST: 'Privacy requests to answer',
  LICENCE: 'Licence or trial ending',
};

interface Message {
  type: keyof typeof NOTIFICATION_TYPES;
  title: string;
  body?: string;
  link: string;
  /** one per user; a repeat with the same key is ignored, so scheduled checks stay quiet */
  dedupeKey?: string;
}

const DAY = 86_400_000;

/**
 * In-app and email notifications. Text stays free of customer identity and prices, since it
 * reaches technicians too; records are referred to by their codes.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly scheduler: SchedulerService,
    private readonly testing: TestingService,
    private readonly reports: ReportsService,
    private readonly planning: PlanningService,
    private readonly licence: LicenceService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {}

  onModuleInit() {
    this.planning.notifyAssigned = (tx, sampleTestId, userId) => this.onAssigned(tx, sampleTestId, userId);
    this.testing.notify = async (tx, e) => {
      const t = await tx.sampleTest.findUniqueOrThrow({ where: { id: e.sampleTestId }, include: { sample: { select: { sampleNo: true } } } });
      if (e.type === 'TEST_REJECTED' && t.assignedToId) {
        await this.send(tx, [t.assignedToId], { type: 'SENT_BACK', title: `${t.testName} on ${t.sample.sampleNo} was sent back`, body: e.reason, link: `/my-tests/${t.id}` });
      }
      if (e.type === 'RESULTS_SUBMITTED') {
        await this.send(tx, await this.holders(tx, 'tests.approve'), { type: 'APPROVAL_DUE', title: `Results to approve: ${t.sample.sampleNo}`, body: t.testName, link: '/approvals?tab=results' });
      }
    };
    this.reports.notify = async (tx, e) => {
      const r = await tx.report.findUniqueOrThrow({ where: { id: e.reportId } });
      if (e.type === 'REPORT_READY_FOR_REVIEW')
        await this.send(tx, await this.holders(tx, 'reports.review'), { type: 'APPROVAL_DUE', title: `Report to review: ${r.reportNo}`, link: `/approvals/reports/${r.id}` });
      if (e.type === 'REPORT_READY_FOR_APPROVAL')
        await this.send(tx, await this.holders(tx, 'reports.approve'), { type: 'APPROVAL_DUE', title: `Report to sign: ${r.reportNo}`, link: `/approvals/reports/${r.id}` });
      if (e.type === 'REPORT_REJECTED')
        await this.send(tx, await this.holders(tx, 'reports.review'), { type: 'SENT_BACK', title: `Report sent back: ${r.reportNo}`, body: e.reason, link: `/approvals/reports/${r.id}` });
    };
    this.scheduler.register({ name: 'tat-check', pattern: '0 8 * * *', run: () => this.tatCheck() });
    this.scheduler.register({ name: 'quotations-expiring', pattern: '15 8 * * *', run: () => this.quotationsExpiring() });
    this.scheduler.register({ name: 'invoices-overdue', pattern: '30 8 * * *', run: () => this.invoicesOverdue() });
    this.scheduler.register({ name: 'licence-check', pattern: '0 9 * * *', run: () => this.licenceCheck() });
    // Mail written inside a transaction goes out here, after commit.
    this.scheduler.register({ name: 'email-sweep', pattern: '* * * * *', run: () => this.mail.sweepQueued() });
  }

  /** Tells administrators as a trial or licence nears its end, and when it has ended. Each step once. */
  async licenceCheck(): Promise<number> {
    const s = await this.licence.status();
    if (!s.licence || !s.endsAt || !s.readOnlyFrom) return 0;
    const what = s.licence.kind === 'trial' ? 'trial' : 'licence';
    const step = s.state === 'expired' ? 'ended' : s.state === 'grace' ? 'grace' : [1, 3, 7, 14].find((d) => s.daysLeft! <= d);
    if (!step) return 0;
    const title =
      s.state === 'expired'
        ? `The ${what} has ended: nothing new can be saved`
        : s.state === 'grace'
          ? `The ${what} has ended; saving stops on ${formatDate(s.readOnlyFrom)}`
          : `The ${what} ends in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}`;
    return this.notifyHolders(this.prisma, 'admin.settings', {
      type: 'LICENCE',
      title,
      body: 'Nothing is deleted when it ends: everything stays readable and can be exported. Add a new licence in Admin, Licence.',
      link: '/admin?tab=licence',
      dedupeKey: `licence-${s.licence.id}-${step}`,
    });
  }

  private async holders(tx: Tx | PrismaService, permission: string): Promise<string[]> {
    const users = await tx.user.findMany({
      where: { isActive: true, deletedAt: null, roles: { some: { role: { isActive: true, deletedAt: null, permissions: { some: { permissionCode: permission } } } } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Tells everyone holding a permission (for example admin.users) about something they need to act on. */
  async notifyHolders(tx: Tx | PrismaService, permission: string, m: Message): Promise<number> {
    return this.send(tx, await this.holders(tx, permission), m);
  }

  /** Writes the in-app row and, if the person wants it, queues the email through the same log. */
  async send(tx: Tx | PrismaService, userIds: string[], m: Message): Promise<number> {
    let created = 0;
    const me = actorId();
    for (const userId of new Set(userIds)) {
      if (userId === me) continue; // nobody needs telling about their own action
      if (m.dedupeKey) {
        const exists = await tx.notification.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey: m.dedupeKey } } });
        if (exists) continue;
      }
      await tx.notification.create({ data: { userId, type: m.type, title: m.title, body: m.body, link: m.link, dedupeKey: m.dedupeKey } });
      created++;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailPreferences: true } });
      const prefs = user.emailPreferences as Record<string, boolean>;
      if (prefs[m.type] === false) continue;
      await this.mail.enqueue(
        {
          to: user.email,
          subject: m.title,
          template: `notification:${m.type}`,
          bodyHtml: `<p>${esc(m.title)}</p>${m.body ? `<p>${esc(m.body)}</p>` : ''}<p><a href="${esc(this.infra.frontendOrigin + m.link)}">Open</a></p>`,
        },
        tx as Tx,
      );
    }
    return created;
  }

  private async onAssigned(tx: Tx, sampleTestId: string, userId: string) {
    const t = await tx.sampleTest.findUniqueOrThrow({ where: { id: sampleTestId }, include: { sample: { select: { sampleNo: true } } } });
    await this.send(tx, [userId], {
      type: 'ASSIGNED',
      title: `Assigned: ${t.testName} on ${t.sample.sampleNo}`,
      body: t.dueDate ? `Due ${formatDate(t.dueDate)}` : undefined,
      link: `/my-tests/${t.id}`,
    });
  }

  // ---------------------------------------------------------------- scheduled checks
  async tatCheck(today = istToday()): Promise<number> {
    const warnDays = await this.settings.get('notifications.tatWarningDays');
    const horizon = new Date(today.getTime() + warnDays * DAY);
    const tests = await this.prisma.sampleTest.findMany({
      where: { deletedAt: null, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'RESULTS_SUBMITTED'] }, dueDate: { lte: horizon } },
      include: { sample: { select: { sampleNo: true } } },
    });
    const planners = await this.holders(this.prisma, 'planning.edit');
    let sent = 0;
    for (const t of tests) {
      const crossed = t.dueDate! < today;
      const recipients = [...(t.assignedToId ? [t.assignedToId] : []), ...(crossed ? planners : [])];
      sent += await this.send(this.prisma, recipients, {
        type: crossed ? 'TAT_CROSSED' : 'TAT_NEAR',
        title: `${crossed ? 'TAT crossed' : 'Due soon'}: ${t.testName} on ${t.sample.sampleNo}`,
        body: `Due ${formatDate(t.dueDate)}`,
        link: `/my-tests/${t.id}`,
        dedupeKey: `${crossed ? 'tat-crossed' : 'tat-near'}:${t.id}:${t.dueDate!.toISOString().slice(0, 10)}`,
      });
    }
    await this.mail.sweepQueued();
    return sent;
  }

  async quotationsExpiring(today = istToday()): Promise<number> {
    const rows = await this.prisma.quotation.findMany({
      where: { deletedAt: null, status: 'SENT', validUntil: { gte: today, lte: new Date(today.getTime() + 3 * DAY) } },
      select: { id: true, quotationNo: true, validUntil: true, createdById: true },
    });
    let sent = 0;
    for (const q of rows) {
      const to = q.createdById ? [q.createdById] : await this.holders(this.prisma, 'quotations.edit');
      sent += await this.send(this.prisma, to, {
        type: 'QUOTATION_EXPIRING',
        title: `Quotation ${q.quotationNo} expires ${formatDate(q.validUntil)}`,
        link: `/quotations/${q.id}`,
        dedupeKey: `quotation-expiring:${q.id}:${q.validUntil.toISOString().slice(0, 10)}`,
      });
    }
    await this.mail.sweepQueued();
    return sent;
  }

  async invoicesOverdue(today = istToday()): Promise<number> {
    const rows = await this.prisma.invoice.findMany({
      where: { deletedAt: null, status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lt: today } },
      select: { id: true, invoiceNo: true, dueDate: true },
    });
    const accounts = await this.holders(this.prisma, 'invoices.edit');
    let sent = 0;
    for (const i of rows) {
      sent += await this.send(this.prisma, accounts, {
        type: 'INVOICE_OVERDUE',
        title: `Invoice ${i.invoiceNo} is overdue`,
        body: `Due ${formatDate(i.dueDate)}`,
        link: `/invoices/${i.id}`,
        dedupeKey: `invoice-overdue:${i.id}`,
      });
    }
    await this.mail.sweepQueued();
    return sent;
  }

  // ---------------------------------------------------------------- user-facing
  async list(q: NotificationQuery) {
    const userId = actorId()!;
    const where: Prisma.NotificationWhereInput = { userId, ...(q.unreadOnly ? { readAt: null } : {}) };
    const [rows, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      ...toPage(
        rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt })),
        total,
        q,
      ),
      unread,
    };
  }

  async markRead(id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: actorId()!, readAt: null }, data: { readAt: new Date() } });
  }

  async markAllRead() {
    await this.prisma.notification.updateMany({ where: { userId: actorId()!, readAt: null }, data: { readAt: new Date() } });
  }

  async preferences() {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId()! }, select: { emailPreferences: true } });
    const prefs = user.emailPreferences as Record<string, boolean>;
    return Object.entries(NOTIFICATION_TYPES).map(([type, label]) => ({ type, label, email: prefs[type] !== false }));
  }

  async updatePreferences(preferences: Record<string, boolean>) {
    const clean = Object.fromEntries(Object.entries(preferences).filter(([k, v]) => k in NOTIFICATION_TYPES && typeof v === 'boolean'));
    await this.prisma.user.update({ where: { id: actorId()! }, data: { emailPreferences: clean as Prisma.InputJsonValue } });
    return this.preferences();
  }
}
