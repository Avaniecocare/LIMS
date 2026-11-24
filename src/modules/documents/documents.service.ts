import { Injectable } from '@nestjs/common';
import { can, currentUser } from '../../common/context.js';
import { AppError, badRequest, forbidden, notFound, requireRecentAuth } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { Prisma, PrismaService } from '../../core/prisma.service.js';
import { MailService, type QueueEmailInput } from '../../core/mail.service.js';
import { QueueService } from '../../core/queue.service.js';
import { ModulesService, type ModuleKey } from '../../core/modules.service.js';
import { RedisService } from '../../core/redis.service.js';
import { StorageService } from '../../core/storage.service.js';
import { WhatsappService, type WhatsappInput } from '../../core/whatsapp.service.js';

export interface GeneratedDocument {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  entity?: string;
  entityId?: string;
  /** defaults to generated */
  category?: string;
}

/** Documents that belong to a module the lab can turn off. */
export function moduleOfKind(kind: string): ModuleKey | null {
  if (kind.startsWith('mis:')) return 'analytics';
  if (['invoice-pdf', 'credit-note-pdf', 'statement-of-account', 'due-invoices-export'].includes(kind)) return 'billing';
  if (kind === 'quotation-pdf') return 'quotations';
  if (kind === 'dispatch-challan') return 'dispatch';
  return null;
}

export interface DocumentHandler {
  /** Checked in the web request, with the caller's permissions. */
  authorize(params: Record<string, unknown>): void | Promise<void>;
  /** Runs in the web request. Sets anything the caller's permissions decide; clients can't supply it. */
  prepare?(params: Record<string, unknown>): Record<string, unknown>;
  /** Runs in the worker. */
  run(params: Record<string, unknown>): Promise<GeneratedDocument>;
  /** Runs after the file is stored, e.g. to record it on the document it belongs to. */
  after?(file: { id: string; sha256: string }, params: Record<string, unknown>): Promise<void>;
  /** Only the server may queue this kind (for example the signed report's final PDF), never a client request. */
  internal?: boolean;
  /** A bulk export of personal or money data: needs the password confirmed, and admins are told it happened. */
  sensitive?: boolean;
}

/** Set by the security module: told about sensitive exports, so admins can see bulk data leaving. */
let onSensitiveExport: ((kind: string) => Promise<void>) | null = null;
export const setSensitiveExportHook = (fn: typeof onSensitiveExport) => {
  onSensitiveExport = fn;
};

/** For exports that are not documents, such as the whole company's data. */
export const reportSensitiveExport = (kind: string) => onSensitiveExport?.(kind) ?? Promise.resolve();

/** Keys only the server sets on a job: an email or WhatsApp message to send, or "this is the official file". Never accepted from a client. */
const SERVER_ONLY_PARAMS = ['email', 'whatsapp', 'final'];

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Background production of PDFs and exports. Web requests only enqueue. */
@Injectable()
export class DocumentsService {
  private readonly handlers = new Map<string, DocumentHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly redis: RedisService,
    private readonly modules: ModulesService,
    private readonly whatsapp: WhatsappService,
  ) {}

  register(kind: string, handler: DocumentHandler) {
    this.handlers.set(kind, handler);
  }

  private handler(kind: string): DocumentHandler {
    const h = this.handlers.get(kind);
    if (!h) throw badRequest(`Unknown document type ${kind}`, [{ field: 'kind', message: 'Unknown document type' }]);
    return h;
  }

  /**
   * A request from the browser. Internal kinds are refused as unknown, and server-only keys are rejected, so a
   * client can't email a document to an address of its choosing or replace the official PDF of a signed report.
   */
  async enqueueFromClient(kind: string, params: Record<string, unknown>) {
    const handler = this.handlers.get(kind);
    if (!handler || handler.internal) throw badRequest(`Unknown document type ${kind}`, [{ field: 'kind', message: 'Unknown document type' }]);
    const module = moduleOfKind(kind);
    if (module) await this.modules.require(module);
    // Each document is a Chromium render or a large export: a generous per-user cap keeps one account from swamping the worker.
    const rateKey = `doc-rate:${currentUser()?.id ?? 'anon'}`;
    const recent = await this.redis.client.incr(rateKey);
    if (recent === 1) await this.redis.client.expire(rateKey, 60);
    if (recent > 30) throw new AppError('RATE_LIMITED', 429, 'Too many documents requested in the last minute. Wait a moment and try again.');
    const reserved = Object.keys(params).filter((k) => SERVER_ONLY_PARAMS.includes(k) || k.startsWith('_'));
    if (reserved.length)
      throw badRequest(
        'These options cannot be set on a document request',
        reserved.map((k) => ({ field: `params.${k}`, message: 'Not allowed' })),
      );
    if (handler.sensitive) {
      await handler.authorize(params);
      requireRecentAuth();
    }
    const job = await this.enqueue(kind, params);
    if (handler.sensitive) await reportSensitiveExport(kind);
    return job;
  }

  /** Server-side callers only. */
  async enqueue(kind: string, params: Record<string, unknown>) {
    const handler = this.handler(kind);
    await handler.authorize(params);
    const job = await this.prisma.documentJob.create({
      data: { kind, params: (handler.prepare?.(params) ?? params) as Prisma.InputJsonValue, createdById: currentUser()?.id },
    });
    await this.queue.documents.add('render', { documentJobId: job.id }, { jobId: `doc-${job.id}` });
    return this.describe(job.id);
  }

  /** For jobs the server creates itself, such as a PDF rendered and then emailed. */
  async queueExisting(documentJobId: string) {
    await this.queue.documents.add('render', { documentJobId }, { jobId: `doc-${documentJobId}` });
  }

  async describe(id: string) {
    const job = await this.prisma.documentJob.findUnique({ where: { id } });
    if (!job) throw notFound('Document');
    // A document job belongs to whoever asked for it. Jobs the system queued (no requester) are nobody's to read here.
    if (!job.createdById || job.createdById !== currentUser()?.id) throw forbidden();
    const signed = job.status === 'DONE' && job.fileId ? await this.storage.signedUrl(job.fileId) : null;
    return { id: job.id, kind: job.kind, status: job.status, error: job.error, url: signed?.url ?? null, filename: signed?.originalName ?? null };
  }

  /** Worker side. */
  async process(documentJobId: string) {
    const job = await this.prisma.documentJob.findUnique({ where: { id: documentJobId } });
    if (!job || job.status === 'DONE') return;
    await this.prisma.documentJob.update({ where: { id: job.id }, data: { status: 'RUNNING' } });
    try {
      const params = job.params as Record<string, unknown>;
      const handler = this.handler(job.kind);
      const doc = await handler.run(params);
      const file = await this.storage.store({
        buffer: doc.buffer,
        originalName: doc.filename,
        mimeType: doc.mimeType,
        category: doc.category ?? 'generated',
        entity: doc.entity,
        entityId: doc.entityId,
      });
      await handler.after?.(file, params);
      const email = params.email as QueueEmailInput | undefined;
      // Together, so a worker stopped here neither loses the email nor, on the retry, sends it twice.
      const emailLogId = await this.prisma.$transaction(async (tx) => {
        await tx.documentJob.update({ where: { id: job.id }, data: { status: 'DONE', fileId: file.id, finishedAt: new Date(), error: null } });
        return email ? this.mail.enqueue({ ...email, attachmentFileIds: [file.id] }, tx) : null;
      });
      // The scheduled sweep sends it if this fails.
      if (emailLogId) await this.mail.dispatch(emailLogId).catch((err: unknown) => logger.warn({ err, emailLogId }, 'email left for the sweep'));
      const whatsapp = params.whatsapp as WhatsappInput | undefined;
      if (whatsapp) await this.whatsapp.enqueue({ ...whatsapp, documentFileId: file.id, documentName: doc.filename });
      return file;
    } catch (e) {
      await this.prisma.documentJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(), // Business errors are meant for users. Infrastructure errors go to the logs, not the screen.
          error: e instanceof AppError ? e.message.slice(0, 500) : 'The document could not be produced. Please try again.',
        },
      });
      throw e;
    }
  }
}

export const requirePermission =
  (...codes: string[]) =>
  () => {
    if (!codes.some((c) => can(c))) throw forbidden();
  };
