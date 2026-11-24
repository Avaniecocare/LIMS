import { finished } from 'node:stream/promises';
import { PassThrough, Readable, Transform } from 'node:stream';
import { Injectable, OnModuleInit } from '@nestjs/common';
import yazl from 'yazl';
import { currentUser } from '../../common/context.js';
import { AppError, conflict, notFound, requireRecentAuth, rule } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { Prisma, PrismaService } from '../../core/prisma.service.js';
import { QueueService } from '../../core/queue.service.js';
import { StorageService } from '../../core/storage.service.js';
import { reportSensitiveExport } from '../documents/documents.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';

/** Never leaves: sign-in secrets, and links that work for whoever holds them. */
export const LEFT_OUT_TABLES = ['_prisma_migrations', 'PasswordResetToken'];
export const LEFT_OUT_COLUMNS: Record<string, string[]> = { User: ['passwordHash', 'totpSecret'], PhoneUploadLink: ['tokenHash'] };
/** The body of these emails holds a one-time sign-in link until it is sent. */
const LEFT_OUT_ROWS: Record<string, string> = { EmailLog: `"template" <> 'password-reset'` };

const BATCH = 1_000;
/** A ZIP is closed after about this much, so each download stays a manageable size. */
const PART_BYTES = 1024 ** 3;
const KEEP_DAYS = 7;
/** After this long a run is taken to have died with its worker. */
const STALE_HOURS = 12;

interface Part {
  fileId: string;
  name: string;
  sizeBytes: number;
  sha256: string;
}
interface Column {
  name: string;
  type: string;
}
interface Table {
  name: string;
  columns: Column[];
  key: Column[];
}

const id = (name: string) => `"${name.replaceAll('"', '""')}"`;
/** Text that a spreadsheet would run as a formula is kept as text with a leading apostrophe; README.txt says so. */
const csvCell = (v: string | null) => {
  if (v === null) return '';
  const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
const safeName = (name: string) => name.replace(/[^\w.\- ()]/g, '_');

/** Writes ZIP files to the store one after another, each as it is produced. */
class Parts {
  readonly done: Part[] = [];
  private zip: yazl.ZipFile | null = null;
  private stored: Promise<void> | null = null;
  private bytes = 0;

  constructor(
    private readonly storage: StorageService,
    private readonly exportId: string,
    private readonly baseName: string,
    private readonly partBytes: number,
  ) {}

  private open(): yazl.ZipFile {
    if (this.zip) return this.zip;
    const zip = new yazl.ZipFile();
    const name = `${this.baseName} part ${this.done.length + 1}.zip`;
    // The ZIP's own errors do not reach its output by themselves.
    const out = new PassThrough();
    zip.on('error', (err: Error) => out.destroy(err));
    zip.outputStream.pipe(out);
    this.stored = this.storage.storeStream(out, { originalName: name, mimeType: 'application/zip', category: 'exports', entity: 'DataExport', entityId: this.exportId }).then((f) => {
      this.done.push({ fileId: f.id, name, sizeBytes: f.sizeBytes, sha256: f.sha256 });
    });
    this.stored.catch(() => undefined); // seen when it is awaited
    this.bytes = 0;
    return (this.zip = zip);
  }

  /** One entry, read to its end before the next begins. */
  async add(path: string, body: Readable, compress: boolean): Promise<void> {
    const zip = this.open();
    // Counts as it passes the bytes on. A 'data' listener would start the flow before the ZIP is reading, and lose rows.
    const counted = new Transform({
      transform: (chunk: Buffer, _enc, done) => {
        this.bytes += chunk.length;
        done(null, chunk);
      },
    });
    body.on('error', (err) => counted.destroy(err));
    body.pipe(counted);
    zip.addReadStream(counted, path, { mtime: new Date(), compress });
    // If the store stops taking the ZIP, nothing reads this entry any more: stop with its reason instead of waiting.
    await Promise.race([finished(counted, { writable: false }), this.stored!.then(() => Promise.reject(new Error('The ZIP ended early')))]);
    if (this.bytes >= this.partBytes) await this.close();
  }

  async close(): Promise<void> {
    if (!this.zip) return;
    this.zip.end();
    await this.stored;
    this.zip = null;
  }
}

/** Everything the lab has, for moving to another system or for its own records. Works when the licence has ended. */
@Injectable()
export class DataExportService implements OnModuleInit {
  /** smaller in tests */
  partBytes = PART_BYTES;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly notifications: NotificationsService,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit() {
    this.scheduler.register({ name: 'data-export-cleanup', pattern: '40 3 * * *', run: () => this.removeExpired() });
  }

  // ---------------------------------------------------------------- in the web request
  async request() {
    requireRecentAuth();
    const me = currentUser()!;
    await this.prisma.dataExport.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] }, createdAt: { lt: new Date(Date.now() - STALE_HOURS * 3_600_000) } },
      data: { status: 'FAILED', error: 'It did not finish. Start it again.', finishedAt: new Date() },
    });
    const row = await this.prisma.dataExport.create({ data: { requestedById: me.id, requestedByName: me.name } }).catch((e: { code?: string }) => {
      throw e.code === 'P2002' ? conflict('An export is already being made. Wait for it to finish.') : e;
    });
    await this.audit.record({ action: 'dataExport.request', entity: 'DataExport', entityId: row.id });
    await reportSensitiveExport('company-export');
    await this.queue.documents.add('company-export', { exportId: row.id }, { jobId: `export-${row.id}`, attempts: 1 });
    return this.describe(row);
  }

  async list() {
    const rows = await this.prisma.dataExport.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    return rows.map((r) => this.describe(r));
  }

  private describe({ parts, ...r }: Prisma.DataExportGetPayload<object>) {
    return { ...r, parts: (parts as unknown as Part[]).map(({ name, sizeBytes, sha256 }) => ({ name, sizeBytes, sha256 })) };
  }

  /** A link that works for a few minutes. */
  async download(exportId: string, part: number) {
    requireRecentAuth();
    const row = await this.prisma.dataExport.findUnique({ where: { id: exportId } });
    const file = (row?.parts as unknown as Part[] | undefined)?.[part - 1];
    if (!row || !file) throw notFound('Export');
    if (row.removedAt) throw rule('EXPORT_REMOVED', 'This export has been removed. Make a new one.');
    await this.audit.record({ action: 'dataExport.download', entity: 'DataExport', entityId: exportId, after: { part } });
    const { url, expiresInSeconds } = await this.storage.signedUrl(file.fileId);
    return { url, expiresInSeconds };
  }

  // ---------------------------------------------------------------- in the worker
  async run(exportId: string): Promise<void> {
    const row = await this.prisma.dataExport.findUnique({ where: { id: exportId } });
    if (!row) return;
    if (row.status === 'RUNNING') {
      // The queue hands a job on when its worker dies. A long export is not started again unasked.
      await this.prisma.dataExport.update({ where: { id: exportId }, data: { status: 'FAILED', finishedAt: new Date(), error: 'It was interrupted. Start it again.' } });
      return;
    }
    if (row.status !== 'QUEUED') return;
    await this.prisma.dataExport.update({ where: { id: exportId }, data: { status: 'RUNNING', startedAt: new Date() } });
    const parts = new Parts(this.storage, exportId, `${safeName(this.company.config.companyName).slice(0, 80)} data ${new Date().toISOString().slice(0, 10)}`, this.partBytes);
    try {
      const count = { tables: 0, rows: 0, files: 0, missingFiles: 0 };
      await parts.add('README.txt', Readable.from([README]), true);
      for (const table of await this.tables()) {
        count.tables++;
        await parts.add(`tables/${safeName(table.name)}.csv`, Readable.from(this.csv(table)), true);
        let rows = 0;
        await parts.add(`data/${safeName(table.name)}.jsonl`, Readable.from(this.jsonl(table, () => rows++)), true);
        count.rows += rows;
      }
      const missing: string[] = [];
      for await (const f of this.fileObjects()) {
        const body = await this.storage.open(f.storageKey);
        if (!body) {
          missing.push(`${f.id},${csvCell(f.originalName)}\r\n`);
          continue;
        }
        await parts.add(`files/${safeName(f.category)}/${f.id} ${safeName(f.originalName)}`, body, false);
        count.files++;
      }
      count.missingFiles = missing.length;
      if (missing.length) await parts.add('missing-files.csv', Readable.from(['file id,name\r\n', ...missing]), true);
      await parts.close();
      await this.prisma.dataExport.update({
        where: { id: exportId },
        data: { ...count, status: 'DONE', parts: parts.done as unknown as Prisma.InputJsonValue, finishedAt: new Date(), expiresAt: new Date(Date.now() + KEEP_DAYS * 86_400_000) },
      });
      await this.notifications.send(this.prisma, [row.requestedById], {
        type: 'DATA_EXPORT',
        title: 'The data export is ready',
        body: `It can be downloaded for ${KEEP_DAYS} days.`,
        link: '/admin?tab=data',
      });
    } catch (err) {
      await this.prisma.dataExport.update({
        where: { id: exportId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: err instanceof AppError ? err.message : 'The export could not be made. Start it again; if it keeps failing, the server log says why.',
        },
      });
      for (const p of parts.done) await this.storage.remove(p.fileId).catch((e: unknown) => logger.warn({ err: e, fileId: p.fileId }, 'part of a failed export left in the store'));
      throw err;
    }
  }

  /** From the database itself, so a table added later is never forgotten. */
  private async tables(): Promise<Table[]> {
    const rows = await this.prisma.$queryRaw<{ table: string; column: string; type: string; keyOrder: number | null }[]>`
      SELECT c.relname AS "table", a.attname AS "column", format_type(a.atttypid, a.atttypmod) AS "type", array_position(i.indkey::int2[], a.attnum)::int AS "keyOrder"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = current_schema()
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
      WHERE c.relkind = 'r'
      ORDER BY c.relname, a.attnum`;
    const tables = new Map<string, Table & { order: Map<string, number> }>();
    for (const r of rows) {
      if (LEFT_OUT_TABLES.includes(r.table)) continue;
      const t = tables.get(r.table) ?? { name: r.table, columns: [] as Column[], key: [] as Column[], order: new Map<string, number>() };
      tables.set(r.table, t);
      const column = { name: r.column, type: r.type };
      if (r.keyOrder !== null) {
        t.key.push(column);
        t.order.set(r.column, r.keyOrder);
      }
      if (!LEFT_OUT_COLUMNS[r.table]?.includes(r.column)) t.columns.push(column);
    }
    return [...tables.values()].map(({ order, ...t }) => ({ ...t, key: t.key.sort((a, b) => order.get(a.name)! - order.get(b.name)!) }));
  }

  /** Every row in key order, a batch at a time, as whatever `select` says. */
  private async *rows(table: Table, select: string): AsyncGenerator<Record<string, string | null>> {
    if (!table.key.length) throw new Error(`Table ${table.name} has no primary key`);
    const key = table.key.map((k) => id(k.name)).join(', ');
    const keyText = table.key.map((k, i) => `${id(k.name)}::text AS "_k${i}"`).join(', ');
    let after: (string | null)[] | null = null;
    for (;;) {
      const where = [LEFT_OUT_ROWS[table.name], after ? `(${key}) > (${table.key.map((k, i) => `$${i + 1}::text::${k.type}`).join(', ')})` : null].filter(Boolean).join(' AND ');
      const batch: Record<string, string | null>[] = await this.prisma.$queryRawUnsafe(
        `SELECT ${select}, ${keyText} FROM ${id(table.name)} t ${where ? `WHERE ${where}` : ''} ORDER BY ${key} LIMIT ${BATCH}`,
        ...(after ?? []),
      );
      yield* batch;
      if (batch.length < BATCH) return;
      after = table.key.map((_, i) => batch[batch.length - 1][`_k${i}`]);
    }
  }

  private async *csv(table: Table) {
    yield `${table.columns.map((c) => csvCell(c.name)).join(',')}\r\n`;
    for await (const r of this.rows(table, table.columns.map((c, i) => `${id(c.name)}::text AS "c${i}"`).join(', '))) yield `${table.columns.map((_, i) => csvCell(r[`c${i}`])).join(',')}\r\n`;
  }

  /** As the database writes it, so amounts keep every digit. */
  private async *jsonl(table: Table, onRow: () => void) {
    const without = (LEFT_OUT_COLUMNS[table.name] ?? []).map((c) => ` - '${c}'`).join('');
    for await (const r of this.rows(table, `(to_jsonb(t)${without})::text AS "j"`)) {
      onRow();
      yield `${r.j}\n`;
    }
  }

  private async *fileObjects() {
    let after: string | undefined;
    for (;;) {
      const batch = await this.prisma.fileObject.findMany({
        where: { category: { not: 'exports' }, ...(after ? { id: { gt: after } } : {}) },
        select: { id: true, storageKey: true, originalName: true, category: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      yield* batch;
      if (batch.length < BATCH) return;
      after = batch[batch.length - 1].id;
    }
  }

  async removeExpired(): Promise<number> {
    const rows = await this.prisma.dataExport.findMany({ where: { removedAt: null, expiresAt: { lt: new Date() } } });
    let removed = 0;
    for (const row of rows) {
      try {
        for (const p of row.parts as unknown as Part[]) await this.storage.remove(p.fileId);
        await this.prisma.dataExport.update({ where: { id: row.id }, data: { removedAt: new Date() } });
        removed++;
      } catch (err) {
        logger.error({ err, exportId: row.id }, 'an old data export could not be removed');
      }
    }
    return removed;
  }
}

const README = `This is a copy of everything the laboratory has in its LIMS.

tables/   One CSV file per table, for Excel and similar.
          Text that a spreadsheet would run as a formula has an apostrophe in front; data/ does not.
data/     The same rows as JSON Lines, exactly as the database holds them, for loading into another system.
files/    Every stored file: reports, invoices, photographs, certificates, the file library.
          The name starts with the file's id, as in tables/FileObject.csv, which also has its SHA-256
          and the record it belongs to.
missing-files.csv, if there is one, lists files the records name but the store no longer has.

With several ZIP files, unpack all of them into the same folder.

Times in tables/ and data/ are in UTC. The rows were read one table after another while the LIMS was in use,
so a record made during the export may be in one table and not in another.

Left out: password hashes, two-factor secrets, one-time links, and password reset emails.
Keep this copy as carefully as the LIMS itself: it holds personal data and customers' results.
`;
