import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { actorId } from '../common/context.js';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';
import { CompanyService } from './company.service.js';
import { Prisma, PrismaService, type Tx } from './prisma.service.js';
import { QueueService } from './queue.service.js';
import { StorageService } from './storage.service.js';

/** Provider-neutral adapter: everything goes through this one interface. */
export interface MailAdapter {
  send(message: {
    from: string;
    to: string;
    cc?: string;
    subject: string;
    html: string;
    attachments: { filename: string; content: Buffer; contentType: string }[];
  }): Promise<void>;
}

export class SmtpMailAdapter implements MailAdapter {
  private readonly transport: Transporter;
  /** json transport keeps messages in memory for tests and white-label checks. */
  readonly sent: { to: string; subject: string; html: string; from: string }[] = [];

  constructor(private readonly cfg: InfraConfig) {
    this.transport =
      cfg.smtp.transport === 'json'
        ? nodemailer.createTransport({ jsonTransport: true })
        : nodemailer.createTransport({
            host: cfg.smtp.host,
            port: cfg.smtp.port,
            secure: cfg.smtp.secure,
            auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.password ?? '' } : undefined,
          });
  }

  async send(message: Parameters<MailAdapter['send']>[0]): Promise<void> {
    await this.transport.sendMail(message);
    if (this.cfg.smtp.transport === 'json') this.sent.push(message);
  }
}

export interface QueueEmailInput {
  to: string;
  cc?: string | null;
  subject: string;
  /** body fragment; wrapped in the branded layout */
  bodyHtml: string;
  template: string;
  entity?: string;
  entityId?: string;
  attachmentFileIds?: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

@Injectable()
export class MailService {
  readonly adapter: SmtpMailAdapter;

  constructor(
    @Inject(INFRA_CONFIG) private readonly cfg: InfraConfig,
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly company: CompanyService,
    private readonly storage: StorageService,
  ) {
    this.adapter = new SmtpMailAdapter(cfg);
  }

  /** Branded wrapper so every email carries the deployed company's identity. */
  wrap(bodyHtml: string): string {
    const c = this.company.config;
    return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:6px;overflow:hidden">
<tr><td style="background:${c.branding.primaryColor};color:#fff;padding:16px 24px;font-size:18px;font-weight:bold">${esc(c.companyName)}</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280">${esc(c.legalName)}<br>${esc(c.labAddress)}<br>${esc(c.phone)} · ${esc(c.email)}</td></tr>
</table></td></tr></table></body></html>`;
  }

  /** Writes the delivery log row, then queues the send. Sent by the worker with retries. */
  async enqueue(input: QueueEmailInput, tx?: Tx): Promise<string> {
    const log = await (tx ?? this.prisma).emailLog.create({
      data: {
        toAddress: input.to,
        ccAddress: input.cc ?? null,
        subject: input.subject,
        template: input.template,
        html: this.wrap(input.bodyHtml),
        attachments: (input.attachmentFileIds ?? []) as Prisma.InputJsonValue,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        createdById: actorId(),
      },
    });
    if (tx) {
      // Queue only after commit so a rollback cannot send mail. Callers inside a transaction
      // use this id with `dispatch` once committed; the sweeper covers anything missed.
      return log.id;
    }
    await this.dispatch(log.id);
    return log.id;
  }

  async dispatch(emailLogId: string): Promise<void> {
    await this.queue.email.add('send', { emailLogId }, { jobId: `email-${emailLogId}` });
  }

  /** Worker side. Throws on failure so BullMQ retries. */
  async deliver(emailLogId: string): Promise<void> {
    const log = await this.prisma.emailLog.findUnique({ where: { id: emailLogId } });
    if (!log || log.status === 'SENT') return;
    await this.prisma.emailLog.update({ where: { id: log.id }, data: { attempts: { increment: 1 } } });
    try {
      const attachments = await Promise.all(
        (log.attachments as string[]).map(async (id) => {
          const f = await this.storage.read(id);
          return { filename: f.originalName, content: f.buffer, contentType: f.mimeType };
        }),
      );
      await this.adapter.send({
        from: `"${this.company.config.companyName.replace(/"/g, '')}" <${this.cfg.smtp.from}>`,
        to: log.toAddress,
        cc: log.ccAddress ?? undefined,
        subject: log.subject,
        html: log.html,
        attachments,
      });
      await this.prisma.emailLog.update({ where: { id: log.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
    } catch (e) {
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', lastError: e instanceof Error ? e.message.slice(0, 500) : 'send failed' },
      });
      throw e;
    }
  }

  /** Queues anything left QUEUED, e.g. written inside a transaction. */
  async sweepQueued(): Promise<number> {
    const stale = await this.prisma.emailLog.findMany({ where: { status: 'QUEUED' }, select: { id: true }, take: 500 });
    await Promise.all(stale.map((s) => this.dispatch(s.id)));
    return stale.length;
  }
}
