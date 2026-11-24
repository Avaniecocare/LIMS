import { Inject, Injectable } from '@nestjs/common';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { MailService } from '../../core/mail.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { QueueService } from '../../core/queue.service.js';
import { RedisService } from '../../core/redis.service.js';
import { StorageService } from '../../core/storage.service.js';
import { LicenceService } from '../licence/licence.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import type { CheckDto, SystemStatusDto } from './operations.dto.js';

const DAY = 86_400_000;
const within = <T>(ms: number, p: Promise<T>): Promise<T> => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('no answer in time')), ms).unref())]);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

type Result = Pick<CheckDto, 'state' | 'detail'>;
const ok = (detail: string): Result => ({ state: 'OK', detail });
const off = (detail: string): Result => ({ state: 'OFF', detail });
const warning = (detail: string): Result => ({ state: 'WARNING', detail });
const problem = (detail: string): Result => ({ state: 'PROBLEM', detail });

/** How the installation is, measured now. Addresses, keys and error texts stay in the server's log. */
@Injectable()
export class StatusService {
  constructor(
    @Inject(INFRA_CONFIG) private readonly cfg: InfraConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly mail: MailService,
    private readonly licence: LicenceService,
    private readonly scheduler: SchedulerService,
  ) {}

  async status(): Promise<SystemStatusDto> {
    const checks = await Promise.all([
      this.check('database', 'Database', () => this.database()),
      this.check('redis', 'Sessions and queues (Redis)', () => this.redisCheck()),
      this.check('storage', 'File store', () => this.store()),
      this.check('worker', 'Background worker', () => this.worker()),
      this.check('scheduled', 'Scheduled checks', () => this.scheduled()),
      this.check('mailServer', 'Mail server', () => this.mailServer()),
      this.check('emails', 'Emails', () => this.emails()),
      this.check('documents', 'PDFs and exports', () => this.documents()),
      this.check('whatsapp', 'WhatsApp', () => this.whatsapp()),
      this.check('einvoice', 'GST e-invoices', () => this.einvoice()),
      this.check('assistant', 'Ask AI', () => this.assistant()),
      this.check('licence', 'Licence', () => this.licenceCheck()),
    ]);
    return { checkedAt: new Date(), version: process.env.APP_VERSION || null, checks };
  }

  private async check(key: string, label: string, run: () => Promise<Result>): Promise<CheckDto> {
    const started = Date.now();
    try {
      return { key, label, ...(await within(6_000, run())), ms: Date.now() - started };
    } catch {
      return { key, label, ...problem('Not answering'), ms: Date.now() - started };
    }
  }

  private async database() {
    const [{ size }] = await this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
    return ok(`Answering; ${(Number(size) / 1024 ** 2).toFixed(0)} MB`);
  }

  private async redisCheck() {
    await this.redis.client.ping();
    return ok('Answering');
  }

  private async store() {
    await this.storage.ping();
    const { _sum, _count } = await this.prisma.fileObject.aggregate({ _sum: { sizeBytes: true }, _count: true, where: { deletedAt: null } });
    return ok(`Answering; ${plural(_count, 'file')}, ${((_sum.sizeBytes ?? 0) / 1024 ** 2).toFixed(0)} MB`);
  }

  private async worker() {
    const { email, documents, scheduled, whatsapp } = this.queue;
    const queues = [email, documents, scheduled, whatsapp];
    const workers = await Promise.all(queues.map((q) => q.getWorkersCount()));
    if (workers.some((n) => n === 0)) return problem('Not running: emails, PDFs and reminders are waiting');
    const oldest = Math.max(
      0,
      ...(await Promise.all(
        queues.map(async (q) => {
          const [job] = await q.getJobs(['waiting'], 0, 0, true);
          return job ? (Date.now() - job.timestamp) / 60_000 : 0;
        }),
      )),
    );
    const waiting = (await Promise.all(queues.map((q) => q.getWaitingCount()))).reduce((a, b) => a + b, 0);
    if (oldest > 10) return warning(`Behind: ${plural(waiting, 'job')} waiting, the oldest for ${Math.round(oldest)} minutes`);
    return ok(waiting ? `Running; ${plural(waiting, 'job')} waiting` : 'Running; nothing waiting');
  }

  /** The every-minute one shows whether the others are running too. */
  private async scheduled() {
    const last = await this.scheduler.lastRun('email-sweep');
    if (!last) return warning('Nothing has run yet');
    const minutes = Math.round((Date.now() - last.getTime()) / 60_000);
    return minutes > 10 ? problem(`Nothing has run for ${minutes} minutes`) : ok('Running');
  }

  private async mailServer() {
    if (this.cfg.smtp.transport === 'json') return off('Test mode: emails are recorded and not sent');
    await this.mail.adapter.verify();
    return ok('Signed in');
  }

  private async emails() {
    const since = new Date(Date.now() - DAY);
    const [failed, sent] = await Promise.all([
      this.prisma.emailLog.count({ where: { status: 'FAILED', createdAt: { gt: since } } }),
      this.prisma.emailLog.count({ where: { status: 'SENT', sentAt: { gt: since } } }),
    ]);
    const text = `${sent.toLocaleString('en-IN')} sent and ${failed.toLocaleString('en-IN')} failed in the last day`;
    return failed ? warning(`${text}: see Emails`) : ok(text);
  }

  private async documents() {
    const failed = await this.prisma.documentJob.count({ where: { status: 'FAILED', createdAt: { gt: new Date(Date.now() - DAY) } } });
    return failed ? warning(`${failed.toLocaleString('en-IN')} failed in the last day`) : ok('None failed in the last day');
  }

  private async whatsapp() {
    if (!this.cfg.whatsapp) return off('Not set up on this server');
    const failed = await this.prisma.whatsappMessage.count({ where: { status: 'FAILED', createdAt: { gt: new Date(Date.now() - DAY) } } });
    return failed ? warning(`${plural(failed, 'message')} failed in the last day`) : ok('No message failed in the last day');
  }

  private async einvoice() {
    if (!this.cfg.einvoice) return off('Not set up on this server');
    const [failed, uncertain] = await Promise.all([
      this.prisma.eInvoice.count({ where: { status: 'FAILED', uncertain: false } }),
      this.prisma.eInvoice.count({ where: { status: { in: ['FAILED', 'PENDING'] }, uncertain: true, updatedAt: { lt: new Date(Date.now() - 300_000) } } }),
    ]);
    return failed + uncertain ? warning(`${plural(failed, 'document')} not registered, ${plural(uncertain, 'document')} without a clear answer from the portal`) : ok('Nothing waiting');
  }

  private async assistant() {
    return this.cfg.help.enabled ? ok('On') : off('Off');
  }

  private async licenceCheck() {
    const s = await this.licence.status();
    if (s.readOnly) return problem('Nothing can be saved: add a licence');
    if (s.state === 'grace') return warning('Ended; saving stops soon');
    if (s.daysLeft === null) return off('None needed');
    return s.daysLeft <= 14 ? warning(`${plural(s.daysLeft, 'day')} left`) : ok(`${plural(s.daysLeft, 'day')} left`);
  }
}
