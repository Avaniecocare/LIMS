import { Injectable } from '@nestjs/common';
import { can, currentUser } from '../../common/context.js';
import { badRequest, forbidden, notFound } from '../../common/errors.js';
import { Prisma, PrismaService } from '../../core/prisma.service.js';
import { MailService, type QueueEmailInput } from '../../core/mail.service.js';
import { QueueService } from '../../core/queue.service.js';
import { StorageService } from '../../core/storage.service.js';

export interface GeneratedDocument {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  entity?: string;
  entityId?: string;
}

export interface DocumentHandler {
  /** Checked in the web request, with the caller's permissions. */
  authorize(params: Record<string, unknown>): void | Promise<void>;
  /** Runs in the worker. */
  run(params: Record<string, unknown>): Promise<GeneratedDocument>;
  /** Runs after the file is stored, e.g. to record it on the document it belongs to. */
  after?(file: { id: string; sha256: string }, params: Record<string, unknown>): Promise<void>;
}

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
  ) {}

  register(kind: string, handler: DocumentHandler) {
    this.handlers.set(kind, handler);
  }

  private handler(kind: string): DocumentHandler {
    const h = this.handlers.get(kind);
    if (!h) throw badRequest(`Unknown document type ${kind}`, [{ field: 'kind', message: 'Unknown document type' }]);
    return h;
  }

  async enqueue(kind: string, params: Record<string, unknown>) {
    await this.handler(kind).authorize(params);
    const job = await this.prisma.documentJob.create({
      data: { kind, params: params as Prisma.InputJsonValue, createdById: currentUser()?.id },
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
    // A document job belongs to whoever asked for it.
    if (job.createdById && job.createdById !== currentUser()?.id) throw forbidden();
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
        category: 'generated',
        entity: doc.entity,
        entityId: doc.entityId,
      });
      await this.prisma.documentJob.update({ where: { id: job.id }, data: { status: 'DONE', fileId: file.id, finishedAt: new Date(), error: null } });
      await handler.after?.(file, params);
      const email = params.email as QueueEmailInput | undefined;
      if (email) await this.mail.enqueue({ ...email, attachmentFileIds: [file.id] });
      return file;
    } catch (e) {
      await this.prisma.documentJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: e instanceof Error ? e.message.slice(0, 500) : 'failed' },
      });
      throw e;
    }
  }
}

export const requirePermission = (...codes: string[]) => () => {
  if (!codes.some((c) => can(c))) throw forbidden();
};
