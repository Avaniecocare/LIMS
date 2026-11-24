import { escapeHtml } from '../common/html.js';
import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { actorId } from '../common/context.js';
import { conflict } from '../common/errors.js';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';
import { CompanyService } from './company.service.js';
import { Prisma, PrismaService, type Tx } from './prisma.service.js';
import { QueueService } from './queue.service.js';
import { StorageService } from './storage.service.js';

/** Provider-neutral adapter: everything goes through this one interface. */
export interface MailAdapter {
  verify(): Promise<void>;
  send(message: { from: string; to: string; cc?: string; subject: string; html: string; attachments: { filename: string; content: Buffer; contentType: string }[] }): Promise<void>;
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

  /** Signs in to the mail server without sending anything. */
  async verify(): Promise<void> {
    if (this.cfg.smtp.transport !== 'json') await this.transport.verify();
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

const esc = escapeHtml;

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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:6px;overflow:hidden">
<tr><td style="background:${c.branding.primaryColor};color:#fff;padding:16px 24px;font-size:18px;font-weight:bold">${esc(c.companyName)}</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280">${esc(c.legalName)}${c.labAddress ? `<br>${esc(c.labAddress)}` : ''}${[c.phone, c.email].filter(Boolean).length ? `<br>${[c.phone, c.email].filter(Boolean).map(esc).join(' · ')}` : ''}${
      c.supportEmail || c.supportPhone
        ? `<br>Support: ${[c.supportEmail, c.supportPhone]
            .filter((x): x is string => !!x)
            .map(esc)
            .join(' · ')}`
        : ''
    }${c.privacyContactEmail ? `<br>Privacy and grievances: ${esc(c.privacyContactName ? `${c.privacyContactName}, ` : '')}${esc(c.privacyContactEmail)}` : ''}${c.termsUrl || c.privacyUrl ? `<br>${[c.termsUrl ? `<a href="${esc(c.termsUrl)}" style="color:#6b7280">Terms</a>` : '', c.privacyUrl ? `<a href="${esc(c.privacyUrl)}" style="color:#6b7280">Privacy</a>` : ''].filter(Boolean).join(' · ')}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  }

  /** Sends at once, without the queue, so the caller learns straight away whether it worked (the setup wizard's test). */
  async sendNow(to: string, subject: string, bodyHtml: string): Promise<void> {
    await this.adapter.send({ from: `"${this.company.config.companyName.replace(/"/g, '')}" <${this.cfg.smtp.from}>`, to, subject, html: this.wrap(bodyHtml), attachments: [] });
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
    // Queue only after commit so a rollback cannot send mail: a caller inside a transaction uses
    // this id with `dispatch` once committed, and the scheduled sweep covers anything missed.
    if (tx) return log.id;
    await this.dispatch(log.id);
    return log.id;
  }

  async dispatch(emailLogId: string): Promise<void> {
    await this.queue.email.add('send', { emailLogId }, { jobId: `email-${emailLogId}` });
  }

  /** Sends the same email again, as a new one. */
  async copy(log: {
    toAddress: string;
    ccAddress: string | null;
    subject: string;
    template: string;
    html: string;
    attachments: Prisma.JsonValue;
    entity: string | null;
    entityId: string | null;
  }): Promise<string> {
    const { toAddress, ccAddress, subject, template, html, entity, entityId } = log;
    const { id } = await this.prisma.emailLog.create({
      data: { toAddress, ccAddress, subject, template, html, entity, entityId, attachments: log.attachments as Prisma.InputJsonValue, createdById: actorId() },
    });
    await this.dispatch(id);
    return id;
  }

  /** Tries a failed or waiting email again now, whether or not its own retries are used up. */
  async retry(emailLogId: string): Promise<void> {
    const job = await this.queue.email.getJob(`email-${emailLogId}`);
    const state = await job?.getState();
    if (state === 'active') throw conflict('This email is being sent right now. Look again in a moment.');
    await this.prisma.emailLog.update({ where: { id: emailLogId }, data: { status: 'QUEUED', lastError: null } });
    if (state === 'delayed') return job!.promote();
    if (state === 'waiting') return;
    // A finished job keeps its id, and adding the same id again would do nothing.
    await job?.remove();
    await this.dispatch(emailLogId);
  }

  /** Of these failed emails, the ones that will still be tried again by themselves. */
  async retrying(emailLogIds: string[]): Promise<Set<string>> {
    const states = await Promise.all(emailLogIds.map((id) => this.queue.email.getJobState(`email-${id}`)));
    return new Set(emailLogIds.filter((_, i) => ['delayed', 'waiting', 'active'].includes(states[i])));
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
      // One-time links (password resets) are blanked from the stored copy once sent, so the log and backups can't be used to take over an account.
      const html = log.template === 'password-reset' ? log.html.replace(/token=[^"'&<\s]+/g, 'token=[removed after sending]') : log.html;
      await this.prisma.emailLog.update({ where: { id: log.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null, html } });
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
