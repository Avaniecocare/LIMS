import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyService } from '../../src/core/company.service.js';
import { EInvoiceService } from '../../src/modules/einvoice/einvoice.service.js';
import { InvoicesService } from '../../src/modules/invoices/invoices.service.js';
import { MailService } from '../../src/core/mail.service.js';
import { QueueService } from '../../src/core/queue.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { StorageService } from '../../src/core/storage.service.js';
import { issuedJob, type FullTeam } from '../support/cycle.js';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { plannedTests } from '../support/workflow.js';

/** Records that must not be lost, altered or approved by the wrong person (audit of November 2026, Medium findings). */
let ctx: Ctx;
let admin: Client, accounts: Client, tech2: Client;
let team: FullTeam;
let fx: Awaited<ReturnType<typeof billingFixture>>;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  const { loadBaseline } = await import('../../src/modules/rbac/baseline.js');
  await ctx.prisma.$transaction(loadBaseline);
  for (const e of ['admin', 'reception', 'planner', 'tech', 'hod', 'reviewer', 'signatory', 'accounts'] as const) await createUser(ctx, `${e}@rec.example`, [ROLE_NAMES[e]], `${e} person`);
  await createUser(ctx, 'tech2@rec.example', [ROLE_NAMES.tech], 'Second tech');
  // Works tests and may approve them: the person separation of duties is about.
  await createUser(ctx, 'lead@rec.example', [ROLE_NAMES.tech, ROLE_NAMES.hod], 'Lead');
  const c = (n: string) => login(ctx, `${n}@rec.example`);
  admin = await c('admin');
  accounts = await c('accounts');
  tech2 = await c('tech2');
  team = { reception: await c('reception'), planner: await c('planner'), tech: await c('tech'), hod: await c('hod'), reviewer: await c('reviewer'), signatory: await c('signatory') };
  fx = await billingFixture(admin, ctx, 'R');
  for (const id of fx.testIds) await admin.post('/masters/test-parameters', { testId: id, code: 'P', name: 'Result', kind: 'TEXT' }).expect(201);
});
afterAll(() => ctx.app.close());

describe('files that are part of a record', () => {
  it('cannot be removed: a signed report keeps its PDF', async () => {
    const { reportId } = await issuedJob(ctx, team, fx.intra.id, [fx.tests.f], { P: 'OK' });
    const { pdfFileId } = await ctx.prisma.reportRevision.findFirstOrThrow({ where: { reportId } });
    const res = await team.reviewer.del(`/files/${pdfFileId}`);
    expect([res.status, res.body.error?.code]).toEqual([422, 'FILE_KEPT']);
    expect((await ctx.prisma.fileObject.findUniqueOrThrow({ where: { id: pdfFileId! } })).deletedAt).toBeNull();
  }, 90000);
});

describe('separation of duties', () => {
  it('counts whoever entered the values, not only whoever submitted the test', async () => {
    const lead = await login(ctx, 'lead@rec.example');
    const { sampleTestIds } = await plannedTests(ctx, { ...team, tech: lead }, fx.intra.id, [fx.tests.f]);
    const id = sampleTestIds[0];
    let d = (await lead.get(`/tests/${id}`).expect(200)).body;
    d = (await lead.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    const values = d.results.map((r: { parameterId: string }) => ({ parameterId: r.parameterId, value: 'OK' }));
    d = (await lead.put(`/tests/${id}/results`, { version: d.version, values }).expect(200)).body;
    // Handed to a colleague, who finishes and submits it.
    await ctx.prisma.sampleTest.update({ where: { id }, data: { assignedToId: tech2.userId, conductedById: tech2.userId } });
    d = (await tech2.get(`/tests/${id}`).expect(200)).body;
    for (const s of d.stages) if (!s.completedAt) d = (await tech2.post(`/tests/${id}/stages/${s.seq}/complete`, { version: d.version }).expect(200)).body;
    d = (await tech2.post(`/tests/${id}/submit`, { version: d.version }).expect(200)).body;
    const own = await lead.post(`/tests/${id}/approve`, { version: d.version });
    expect([own.status, own.body.error?.code]).toEqual([403, 'SELF_APPROVAL']);
    await team.hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
  }, 60000);
});

describe('invoices', () => {
  const draftFor = async (customerId: string) => {
    const { job, sampleTestIds } = await issuedJob(ctx, team, customerId, [fx.tests.f], { P: 'OK' });
    return { sampleTestIds, draft: (await accounts.post('/invoices', { customerId, jobIds: [job.id] }).expect(201)).body };
  };

  it('are not issued with nothing on them, so no number is used up', async () => {
    const { draft, sampleTestIds } = await draftFor(fx.intra.id);
    await ctx.prisma.$transaction((tx) => ctx.app.get(InvoicesService).removeFromDrafts(tx, sampleTestIds));
    const version = (await accounts.get(`/invoices/${draft.id}`).expect(200)).body.version;
    const res = await accounts.post(`/invoices/${draft.id}/issue`, { version });
    expect([res.status, res.body.error?.code]).toEqual([422, 'NO_LINES']);
  }, 90000);

  it('keep their lines when work is cancelled after they are issued', async () => {
    const { draft, sampleTestIds } = await draftFor(fx.intra.id);
    await accounts.post(`/invoices/${draft.id}/issue`, { version: draft.version }).expect(200);
    await ctx.prisma.$transaction((tx) => ctx.app.get(InvoicesService).removeFromDrafts(tx, sampleTestIds));
    expect(await ctx.prisma.invoiceLine.count({ where: { invoiceId: draft.id } })).toBeGreaterThan(0);
  }, 90000);

  it('stay B2C when the customer gets a GSTIN later', async () => {
    const einvoice = ctx.app.get(EInvoiceService);
    vi.spyOn(einvoice, 'active').mockResolvedValue(true);
    try {
      const withGstin = await ctx.prisma.customer
        .findFirstOrThrow({ where: { gstin: { not: null } } })
        .catch(() => ctx.prisma.customer.update({ where: { id: fx.intra.id }, data: { gstin: '27CCCCC1234C1ZQ' } }));
      expect(await einvoice.requiredFor({ gstin: null }, withGstin.id)).toBe(false);
      expect(await einvoice.requiredFor({ gstin: '27CCCCC1234C1ZQ' }, withGstin.id)).toBe(true);
      expect(await einvoice.requiredFor(null, withGstin.id)).toBe(true); // a draft follows the customer
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('a document sent by email', () => {
  it('is never lost or doubled when the queue fails at the last moment', async () => {
    const { draft } = await (async () => {
      const { job } = await issuedJob(ctx, team, fx.intra.id, [fx.tests.f], { P: 'OK' });
      return { draft: (await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [job.id] }).expect(201)).body };
    })();
    await accounts.post(`/invoices/${draft.id}/issue`, { version: draft.version, emailTo: 'a@b.example' }).expect(200);
    const job = await ctx.prisma.documentJob.findFirstOrThrow({ where: { kind: 'invoice-pdf', status: 'QUEUED' }, orderBy: { createdAt: 'desc' } });
    const add = vi.spyOn(ctx.app.get(QueueService).email, 'add').mockRejectedValueOnce(new Error('redis gone'));
    const docs = ctx.app.get(DocumentsService);
    await docs.process(job.id);
    await docs.process(job.id); // the retry after a crash
    expect((await ctx.prisma.documentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('DONE');
    expect(await ctx.prisma.emailLog.count({ where: { entity: 'Invoice', entityId: draft.id, status: 'QUEUED' } })).toBe(1);
    add.mockRestore();
    expect(await ctx.app.get(MailService).sweepQueued()).toBeGreaterThan(0);
  }, 90000);
});

describe('the lab profile in memory', () => {
  it('keeps its logo while it reloads', async () => {
    const company = ctx.app.get(CompanyService);
    expect(company.logoDataUri()).not.toBeNull();
    // Slow storage: before, every document made in this window had no logo.
    vi.spyOn(ctx.app.get(StorageService), 'read').mockImplementation(() => new Promise((_, no) => setTimeout(() => no(new Error('storage slow')), 300)));
    try {
      const reloading = company.reload();
      await new Promise((r) => setTimeout(r, 100));
      expect(company.logoDataUri()).not.toBeNull();
      await reloading;
      expect(company.logoDataUri()).not.toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('settings and the audit log', () => {
  it('needs at least one working day', async () => {
    const s = ((await admin.get('/admin/settings').expect(200)).body as { key: string; version: number }[]).find((x) => x.key === 'calendar.workingDays')!;
    await admin.put('/admin/settings/calendar.workingDays', { value: [], version: s.version }).expect(400);
  });

  it('shows the whole of the last day asked for, in Indian time', async () => {
    const at = new Date('2026-03-10T18:00:00Z'); // 23:30 on the 10th in India
    await ctx.prisma.auditLog.create({ data: { action: 'test.late', entity: 'Test', entityId: 'x', at } });
    const on = async (from: string, to: string) => (await admin.get(`/admin/audit?from=${from}&to=${to}&action=test.late`).expect(200)).body.meta.total;
    expect(await on('2026-03-10', '2026-03-10')).toBe(1);
    expect(await on('2026-03-11', '2026-03-12')).toBe(0);
    expect(await on('2026-03-01', '2026-03-09')).toBe(0);
  });
});
