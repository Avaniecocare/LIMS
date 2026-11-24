import { Injectable } from '@nestjs/common';
import { badRequest, notFound } from '../../common/errors.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { AuditService } from '../../core/audit.service.js';
import { MailService } from '../../core/mail.service.js';
import { Prisma, PrismaService } from '../../core/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { EmailQuery } from './operations.dto.js';

/** Its link is for one person and soon expires: never shown to anyone else, and never sent again from here. */
const PRIVATE_TEMPLATE = 'password-reset';

// The body stays out of every list: it is large, and can hold a one-time link.
const columns = {
  id: true,
  toAddress: true,
  ccAddress: true,
  subject: true,
  template: true,
  attachments: true,
  entity: true,
  entityId: true,
  status: true,
  attempts: true,
  lastError: true,
  sentAt: true,
  createdById: true,
  createdAt: true,
} satisfies Prisma.EmailLogSelect;
type Row = Prisma.EmailLogGetPayload<{ select: typeof columns }>;

@Injectable()
export class OutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(q: EmailQuery) {
    const contains = { contains: q.q, mode: 'insensitive' } as const;
    const where: Prisma.EmailLogWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ toAddress: contains }, { ccAddress: contains }, { subject: contains }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.emailLog.findMany({ where, select: columns, orderBy: orderBy(q, ['createdAt', 'toAddress', 'subject', 'status'], 'createdAt'), ...skipTake(q) }),
      this.prisma.emailLog.count({ where }),
    ]);
    return toPage(await this.describe(rows), total, q);
  }

  private async describe(rows: Row[]) {
    const [retrying, people] = await Promise.all([
      this.mail.retrying(rows.filter((r) => r.status === 'FAILED').map((r) => r.id)),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter((id): id is string => !!id))] } }, select: { id: true, name: true } }),
    ]);
    return rows.map(({ attachments, createdById, ...r }) => ({
      ...r,
      attachments: (attachments as string[]).length,
      sentBy: people.find((p) => p.id === createdById)?.name ?? null,
      retrying: retrying.has(r.id),
      canResend: r.template !== PRIVATE_TEMPLATE && r.status !== 'QUEUED',
    }));
  }

  /** A failed email is tried again; one that was sent goes out again as a new email, to the same people. */
  async resend(id: string) {
    const log = await this.prisma.emailLog.findUnique({ where: { id } });
    if (!log) throw notFound('Email');
    if (log.template === PRIVATE_TEMPLATE) throw badRequest('A password reset cannot be sent again. Ask the person to request a new one on the sign-in page.');
    if (log.status === 'QUEUED') throw badRequest('This email is already waiting to be sent.');
    await this.audit.record({ action: 'email.resend', entity: 'EmailLog', entityId: id, after: { to: log.toAddress, subject: log.subject, was: log.status } });
    let resent = id;
    if (log.status === 'SENT') resent = await this.mail.copy(log);
    else await this.mail.retry(id);
    const row = await this.prisma.emailLog.findUniqueOrThrow({ where: { id: resent }, select: columns });
    return (await this.describe([row]))[0];
  }

  /** Every attempt failed. Tells whoever sent it, and those who look after emails. */
  async onGivenUp(emailLogId: string): Promise<void> {
    const log = await this.prisma.emailLog.findUnique({ where: { id: emailLogId }, select: columns });
    // An alert that cannot be emailed must not raise another alert; a failed reset shows on the person's own screen.
    if (!log || log.status !== 'FAILED' || log.template.startsWith('notification:') || log.template === PRIVATE_TEMPLATE) return;
    const message = { type: 'EMAIL_FAILED', title: `Not sent: ${log.subject}`, dedupeKey: `email-failed:${log.id}:${log.attempts}` } as const;
    await this.notifications.notifyHolders(this.prisma, 'admin.emails', { ...message, body: 'Every attempt failed. See why, and send it again, in Admin, Emails.', link: '/admin?tab=outbox' });
    if (log.createdById) await this.notifications.send(this.prisma, [log.createdById], { ...message, body: 'Every attempt failed. Check the address and tell your administrator.', link: linkTo(log) });
  }
}

function linkTo(log: Row): string {
  const page = { Report: 'reports', Invoice: 'invoices', Quotation: 'quotations', Job: 'jobs' }[log.entity ?? ''];
  return page && log.entityId ? `/${page}/${log.entityId}` : '/';
}
