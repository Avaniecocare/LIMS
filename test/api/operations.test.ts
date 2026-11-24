import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { MailService } from '../../src/core/mail.service.js';
import { QueueService } from '../../src/core/queue.service.js';
import { StorageService } from '../../src/core/storage.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { DataExportService, LEFT_OUT_COLUMNS, LEFT_OUT_TABLES } from '../../src/modules/operations/data-export.service.js';
import { OutboxService } from '../../src/modules/operations/outbox.service.js';
import { SchedulerService } from '../../src/modules/scheduler/scheduler.service.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { readZip } from '../support/zip.js';

let ctx: Ctx;
let admin: Client;
let sales: Client;
let mail: MailService;
let realSend: MailService['adapter']['send'];

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  await createUser(ctx, 'admin@x.example', [ROLE_NAMES.admin], 'Asha Admin');
  await createUser(ctx, 'sales@x.example', [ROLE_NAMES.sales], 'Sunil Sales');
  admin = await login(ctx, 'admin@x.example');
  sales = await login(ctx, 'sales@x.example');
  mail = ctx.app.get(MailService);
  realSend = mail.adapter.send.bind(mail.adapter);
  await ctx.app.get(QueueService).email.drain();
});
afterAll(() => ctx.app.close());

const email = (over: object = {}) =>
  ctx.prisma.emailLog.create({ data: { toAddress: 'buyer@customer.example', subject: 'Report R-1', template: 'report', html: '<p>body</p>', entity: 'Report', entityId: 'r1', ...over } });

describe('system status', () => {
  it('measures each part, and says nothing that helps an attacker', async () => {
    const { body } = await admin.get('/admin/status').expect(200);
    const of = (key: string) => body.checks.find((c: { key: string }) => c.key === key);
    for (const key of ['database', 'redis', 'storage']) expect(of(key)).toMatchObject({ state: 'OK' });
    expect(of('worker')).toMatchObject({ state: 'PROBLEM' }); // none runs in this test
    expect(of('scheduled')).toMatchObject({ state: 'WARNING' });
    expect(of('mailServer')).toMatchObject({ state: 'OFF' }); // nothing is really sent here, so it must not look fine
    expect(of('licence')).toMatchObject({ state: 'OFF', detail: 'None needed' });
    expect(JSON.stringify(body)).not.toMatch(/localhost|127\.0\.0\.1|S3RVER|redis:\/\//);
  });

  it('does not call a new installation’s store broken', async () => {
    const storage = ctx.app.get(StorageService) as unknown as { cfg: { s3: { bucket: string } }; ping: () => Promise<void> };
    const { bucket } = storage.cfg.s3;
    storage.cfg.s3.bucket = `lims-new-${Date.now()}`;
    await storage.ping();
    await storage.ping();
    storage.cfg.s3.bucket = bucket;
  });

  it('shows what is broken', async () => {
    const storage = ctx.app.get(StorageService);
    const ping = storage.ping.bind(storage);
    storage.ping = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:9000'));
    await email({ status: 'FAILED' });
    const scheduler = ctx.app.get(SchedulerService);
    await scheduler.run('email-sweep');
    const { body } = await admin.get('/admin/status').expect(200);
    storage.ping = ping;
    const of = (key: string) => body.checks.find((c: { key: string }) => c.key === key);
    expect(of('storage')).toMatchObject({ state: 'PROBLEM', detail: 'Not answering' });
    expect(of('emails')).toMatchObject({ state: 'WARNING', detail: '0 sent and 1 failed in the last day: see Emails' });
    expect(of('scheduled')).toMatchObject({ state: 'OK' });
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    await sales.get('/admin/status').expect(403);
  });
});

describe('sent and failed emails', () => {
  it('lists them without their content, and only for those allowed', async () => {
    const reset = await email({ template: 'password-reset', subject: 'Reset your password', html: '<a href="https://x/reset?token=SECRET-TOKEN">' });
    const { body } = await admin.get('/admin/emails?pageSize=50').expect(200);
    expect(JSON.stringify(body)).not.toMatch(/SECRET-TOKEN|html/);
    expect(body.data.find((e: { id: string }) => e.id === reset.id)).toMatchObject({ canResend: false });
    await sales.get('/admin/emails').expect(403);
    await sales.post(`/admin/emails/${reset.id}/resend`).expect(403);
    await admin.post(`/admin/emails/${reset.id}/resend`).expect(400);
    const failed = (await admin.get('/admin/emails?status=FAILED').expect(200)).body.data;
    expect(failed.every((e: { status: string }) => e.status === 'FAILED')).toBe(true);
    expect((await admin.get('/admin/emails?q=BUYER@customer').expect(200)).body.meta.total).toBeGreaterThan(0);
    await admin.get('/admin/emails?status=NONSENSE').expect(400);
  });

  it('sends a failed email again even after its own retries are used up', async () => {
    const log = await email({ attachments: [] });
    mail.adapter.send = () => Promise.reject(new Error('550 mailbox unavailable'));
    await mail.dispatch(log.id);
    await expect(mail.deliver(log.id)).rejects.toThrow('550');
    const { email: queue } = ctx.app.get(QueueService);
    // As the queue leaves it when it has given up.
    const { Worker } = await import('bullmq');
    const worker = new Worker(queue.name, () => Promise.reject(new Error('550')), { connection: queue.opts.connection, settings: { backoffStrategy: () => 1 } });
    const job = (await queue.getJob(`email-${log.id}`))!;
    await expect.poll(() => job.getState(), { timeout: 10_000 }).toBe('delayed');
    expect((await admin.get('/admin/emails?status=FAILED').expect(200)).body.data.find((e: { id: string }) => e.id === log.id)).toMatchObject({ retrying: true, lastError: '550 mailbox unavailable' });
    for (let i = 0; i < 4; i++) {
      await job.promote().catch(() => undefined);
      await expect.poll(() => job.getState(), { timeout: 10_000 }).toMatch(/delayed|failed/);
    }
    await expect.poll(() => job.getState(), { timeout: 10_000 }).toBe('failed');
    await worker.close();

    mail.adapter.send = realSend;
    const { body } = await admin.post(`/admin/emails/${log.id}/resend`).expect(200);
    expect(body).toMatchObject({ status: 'QUEUED', lastError: null, canResend: false });
    expect(await queue.getJobState(`email-${log.id}`)).toBe('waiting');
    await mail.deliver(log.id);
    expect(await ctx.prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({ status: 'SENT' });
    expect(await ctx.prisma.auditLog.findFirst({ where: { action: 'email.resend', entityId: log.id } })).toMatchObject({ userName: 'Asha Admin' });
  }, 60_000);

  it('sends a delivered email again as a new one, to the same people', async () => {
    const log = await email({ status: 'SENT', sentAt: new Date(), ccAddress: 'cc@customer.example', attachments: ['f1'] });
    const { body } = await admin.post(`/admin/emails/${log.id}/resend`).expect(200);
    expect(body.id).not.toBe(log.id);
    expect(body).toMatchObject({ toAddress: 'buyer@customer.example', ccAddress: 'cc@customer.example', attachments: 1, sentBy: 'Asha Admin' });
    expect(await ctx.prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({ status: 'SENT' });
    await admin.post(`/admin/emails/${body.id}/resend`).expect(400); // already waiting
  });

  it('tells the sender and those who look after emails when one is given up on, and never about its own alerts', async () => {
    const outbox = ctx.app.get(OutboxService);
    const log = await email({ status: 'FAILED', attempts: 5, createdById: sales.userId });
    await outbox.onGivenUp(log.id);
    await outbox.onGivenUp(log.id); // once only
    const told = await ctx.prisma.notification.findMany({ where: { type: 'EMAIL_FAILED' }, orderBy: { link: 'asc' } });
    expect(told.map((n) => [n.userId, n.link])).toEqual([
      [admin.userId, '/admin?tab=outbox'],
      [sales.userId, '/reports/r1'],
    ]);
    for (const template of ['notification:EMAIL_FAILED', 'password-reset']) await outbox.onGivenUp((await email({ status: 'FAILED', template })).id);
    expect(await ctx.prisma.notification.count({ where: { type: 'EMAIL_FAILED' } })).toBe(2);
  });
});

describe('audit log', () => {
  it('exports what the filters show, as text a spreadsheet will not run', async () => {
    await ctx.prisma.auditLog.create({ data: { action: 'thing.change', entity: 'Thing', entityId: 't1', userName: 'Sunil Sales', reason: '=HYPERLINK("http://evil")', after: { a: 1 } } });
    await ctx.prisma.auditLog.create({ data: { action: 'other.change', entity: 'Other' } });
    expect((await admin.get('/admin/audit?q=t1').expect(200)).body.data.map((r: { entity: string }) => r.entity)).toEqual(['Thing']);
    const { body } = await admin.post('/documents', { kind: 'audit-export', params: { q: 't1', from: 'nonsense', where: { id: 1 } } }).expect(201);
    const docs = ctx.app.get(DocumentsService);
    const file = await docs.process(body.id);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await ctx.app.get(StorageService).read(file!.id)).buffer as never);
    const ws = wb.worksheets[0];
    expect(ws.rowCount).toBe(2);
    expect(ws.getRow(2).values).toEqual(expect.arrayContaining(['Sunil Sales', 'thing.change', 'Thing', 't1', `'=HYPERLINK("http://evil")`, '{"a":1}']));
    expect(await ctx.prisma.auditLog.count({ where: { action: 'security.alert', after: { path: ['title'], string_contains: 'the audit log' } } })).toBe(1);
  });

  it('needs the permission and a confirmed password', async () => {
    await sales.post('/documents', { kind: 'audit-export', params: {} }).expect(403);
    const fresh = await login(ctx, 'admin@x.example', undefined, { reauth: false });
    expect((await fresh.post('/documents', { kind: 'audit-export', params: {} }).expect(403)).body.error.code).toBe('REAUTH_REQUIRED');
  });
});

describe('the company’s whole data', () => {
  let service: DataExportService;
  const run = async () => {
    const { body } = await admin.post('/admin/data-exports').expect(200);
    await service.run(body.id);
    const row = await ctx.prisma.dataExport.findUniqueOrThrow({ where: { id: body.id } });
    const entries: Record<string, Buffer> = {};
    const storage = ctx.app.get(StorageService);
    for (const p of row.parts as { fileId: string }[]) for (const [k, v] of Object.entries(readZip((await storage.read(p.fileId)).buffer))) entries[k] = v;
    return { row, entries };
  };
  beforeAll(async () => {
    service = ctx.app.get(DataExportService);
    await ctx.app.get(QueueService).documents.drain();
  });

  it('leaves out every secret, in this version and the next', async () => {
    const columns = await ctx.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`;
    const known = new Set(['FileObject.sha256', 'User.passwordChangedAt', 'User.mustChangePassword', 'User.totpEnabled', 'HelpQuestion.inputTokens', 'HelpQuestion.outputTokens']);
    const open = columns
      .filter((c) => /password|secret|token|hash|otp|credential|apikey/i.test(c.column_name))
      .filter((c) => !LEFT_OUT_TABLES.includes(c.table_name) && !LEFT_OUT_COLUMNS[c.table_name]?.includes(c.column_name))
      .map((c) => `${c.table_name}.${c.column_name}`)
      .filter((c) => !known.has(c));
    // A new column here holds a secret (leave it out of the export) or does not (add it to the list above).
    expect(open).toEqual([]);
  });

  it('holds every table and every stored file, and nothing that signs anyone in', async () => {
    const storage = ctx.app.get(StorageService);
    const pdf = await storage.store({ buffer: Buffer.from('%PDF-1.7 a report'), originalName: 'R 1.pdf', mimeType: 'application/pdf', category: 'report' });
    const gone = await ctx.prisma.fileObject.create({
      data: { storageKey: 'report/2020/gone', originalName: 'lost, really.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x', category: 'report' },
    });
    // More than one batch, with keys out of insertion order, an exact amount, and text a spreadsheet would run.
    await ctx.prisma.lookupValue.createMany({
      data: Array.from({ length: 2_500 }, (_, i) => ({ kind: 'RECEIPT_MODE' as const, code: `C${(i * 7919) % 2_500}`, label: i === 0 ? '=1+1' : `Say "hi", ${i}` })),
    });
    const test = await ctx.prisma.testMaster.create({ data: { code: 'EX', name: 'Exact' } });
    await ctx.prisma.standardRate.create({ data: { testId: test.id, rate: '10450.10', effectiveFrom: new Date() } });
    const big = await storage.store({ buffer: Buffer.alloc(9_000_000, 'abc'), originalName: 'big.bin', mimeType: 'application/pdf', category: 'report' });
    const { row, entries } = await run();
    expect(row).toMatchObject({ status: 'DONE', missingFiles: 1, requestedByName: 'Asha Admin' });

    const tables = (await ctx.prisma.$queryRaw<{ t: string }[]>`SELECT tablename AS t FROM pg_tables WHERE schemaname = current_schema()`).map((r) => r.t);
    for (const t of tables) expect(!!entries[`data/${t}.jsonl`] && !!entries[`tables/${t}.csv`]).toBe(!LEFT_OUT_TABLES.includes(t));
    const lines = (t: string) => entries[`data/${t}.jsonl`].toString().split('\n').slice(0, -1);
    // Every row of every table. The export itself writes to these after their turn has come.
    for (const t of tables.filter((t) => entries[`data/${t}.jsonl`] && !['DataExport', 'FileObject', 'Notification', 'EmailLog', 'AuditLog'].includes(t))) {
      const [{ n }] = await ctx.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`);
      expect([t, lines(t).map((l) => JSON.parse(l)).length]).toEqual([t, n]);
    }
    expect(new Set(lines('LookupValue').map((l) => JSON.parse(l).id)).size).toBe(await ctx.prisma.lookupValue.count());
    expect(lines('UserRole').length).toBe(await ctx.prisma.userRole.count()); // a key of two columns
    expect(lines('StandardRate')[0]).toContain('10450.10');
    const csv = entries['tables/LookupValue.csv'].toString();
    expect(csv).toContain(`'=1+1`);
    expect(csv).toContain(`"Say ""hi"", 1"`);

    expect(entries[`files/report/${pdf.id} R 1.pdf`].toString()).toBe('%PDF-1.7 a report');
    const { createHash } = await import('node:crypto');
    for (const f of [pdf, big]) expect(createHash('sha256').update(entries[`files/report/${f.id} ${f.originalName}`]).digest('hex')).toBe(f.sha256);
    expect(entries['missing-files.csv'].toString()).toBe(`file id,name\r\n${gone.id},"lost, really.pdf"\r\n`);
    expect(entries['README.txt'].toString()).toContain('personal data');
    const everything = Object.entries(entries)
      .map(([, v]) => v.toString())
      .join('\n');
    const { passwordHash } = await ctx.prisma.user.findFirstOrThrow({ select: { passwordHash: true } });
    expect(everything).not.toContain(passwordHash);
    expect(everything).not.toMatch(/argon2|SECRET-TOKEN|passwordHash|totpSecret/);
    expect(everything).toContain('sales@x.example');
  }, 60_000);

  it('is cut into parts, which do not go into the next export', async () => {
    service.partBytes = 50_000;
    const { row, entries } = await run();
    service.partBytes = 1024 ** 3;
    const parts = row.parts as { name: string; sizeBytes: number; fileId: string }[];
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[1].name).toMatch(/^BluePeak Testing Labs data \d{4}-\d\d-\d\d part 2\.zip$/);
    expect(Object.keys(entries).filter((k) => k.startsWith('files/exports/'))).toEqual([]);
    expect(entries['data/User.jsonl']).toBeDefined();
  }, 60_000);

  it('is only for those allowed, after their password, one at a time, and every download is recorded', async () => {
    await sales.post('/admin/data-exports').expect(403);
    const fresh = await login(ctx, 'admin@x.example', undefined, { reauth: false });
    expect((await fresh.post('/admin/data-exports').expect(403)).body.error.code).toBe('REAUTH_REQUIRED');
    const { body } = await admin.post('/admin/data-exports').expect(200);
    await admin.post('/admin/data-exports').expect(409);
    await service.run(body.id);
    expect((await fresh.post(`/admin/data-exports/${body.id}/parts/1/download`).expect(403)).body.error.code).toBe('REAUTH_REQUIRED');
    const { url } = (await admin.post(`/admin/data-exports/${body.id}/parts/1/download`).expect(200)).body;
    expect((await fetch(url)).headers.get('content-disposition')).toMatch(/^attachment/);
    await admin.post(`/admin/data-exports/${body.id}/parts/2/download`).expect(404);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'dataExport.download', entityId: body.id } })).toBe(1);
    // Not through the general file links either, whoever asks.
    const { parts } = await ctx.prisma.dataExport.findUniqueOrThrow({ where: { id: body.id } });
    await admin.get(`/files/${(parts as { fileId: string }[])[0].fileId}/url`).expect(403);
    expect(JSON.stringify((await admin.get('/admin/data-exports').expect(200)).body)).not.toContain('fileId');
    expect(await ctx.prisma.notification.findFirst({ where: { userId: admin.userId, type: 'DATA_EXPORT' } })).toMatchObject({ link: '/admin?tab=data' });
  }, 60_000);

  it('is removed after a week', async () => {
    const row = await ctx.prisma.dataExport.findFirstOrThrow({ where: { status: 'DONE' }, orderBy: { createdAt: 'desc' } });
    await ctx.prisma.dataExport.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await service.removeExpired()).toBe(1);
    expect((await admin.post(`/admin/data-exports/${row.id}/parts/1/download`).expect(422)).body.error.code).toBe('EXPORT_REMOVED');
    const [{ fileId }] = row.parts as { fileId: string }[];
    const { storageKey } = await ctx.prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
    expect(await ctx.app.get(StorageService).open(storageKey)).toBeNull();
    expect(await service.removeExpired()).toBe(0);
  });

  it('says so when it fails or is interrupted, and can be started again', async () => {
    const storage = ctx.app.get(StorageService);
    const open = storage.open.bind(storage);
    storage.open = () => Promise.reject(new Error('store down at 10.0.0.5'));
    const first = (await admin.post('/admin/data-exports').expect(200)).body;
    await expect(service.run(first.id)).rejects.toThrow('store down');
    storage.open = open;
    expect(await ctx.prisma.dataExport.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'FAILED', error: expect.not.stringContaining('10.0.0.5') });

    const second = (await admin.post('/admin/data-exports').expect(200)).body;
    await ctx.prisma.dataExport.update({ where: { id: second.id }, data: { status: 'RUNNING' } });
    await service.run(second.id); // handed on after the worker died
    expect(await ctx.prisma.dataExport.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: 'FAILED', error: 'It was interrupted. Start it again.' });
    await admin.post('/admin/data-exports').expect(200);
  }, 60_000);

  it('stops, rather than waiting for ever, when the store refuses the ZIP', async () => {
    await ctx.prisma.dataExport.updateMany({ where: { status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED' } });
    const storage = ctx.app.get(StorageService);
    const real = storage.storeStream.bind(storage);
    storage.storeStream = async (body) => {
      body.resume();
      await new Promise((r) => setTimeout(r, 20));
      throw new Error('access denied');
    };
    const { body } = await admin.post('/admin/data-exports').expect(200);
    await expect(service.run(body.id)).rejects.toThrow('access denied');
    storage.storeStream = real;
    expect(await ctx.prisma.dataExport.findUniqueOrThrow({ where: { id: body.id } })).toMatchObject({ status: 'FAILED' });
  }, 30_000);
});
