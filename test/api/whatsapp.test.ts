import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WhatsappService, whatsappNumber } from '../../src/core/whatsapp.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { issue, issuedJob, type FullTeam } from '../support/cycle.js';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

let ctx: Ctx;
let admin: Client, accounts: Client, tech: Client, reception: Client;
let team: FullTeam;
let fx: Awaited<ReturnType<typeof billingFixture>>;
let wa: WhatsappService;

/** Runs what the worker would: queued document renders, then queued WhatsApp messages. */
const drain = async () => {
  const docs = ctx.app.get(DocumentsService);
  for (const d of await ctx.prisma.documentJob.findMany({ where: { status: 'QUEUED' } })) await docs.process(d.id);
  for (const m of await ctx.prisma.whatsappMessage.findMany({ where: { status: 'QUEUED' } })) await wa.deliver(m.id);
};

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  const { loadBaseline } = await import('../../src/modules/rbac/baseline.js');
  await ctx.prisma.$transaction(loadBaseline);
  for (const [e, r] of Object.entries({
    admin: ROLE_NAMES.admin,
    reception: ROLE_NAMES.reception,
    planner: ROLE_NAMES.planner,
    tech: ROLE_NAMES.tech,
    hod: ROLE_NAMES.hod,
    reviewer: ROLE_NAMES.reviewer,
    signatory: ROLE_NAMES.signatory,
    accounts: ROLE_NAMES.accounts,
  }))
    await createUser(ctx, `${e}@w.example`, [r], `${e} person`);
  const c = async (n: string) => login(ctx, `${n}@w.example`);
  admin = await c('admin');
  reception = await c('reception');
  tech = await c('tech');
  accounts = await c('accounts');
  team = { reception, planner: await c('planner'), tech, hod: await c('hod'), reviewer: await c('reviewer'), signatory: await c('signatory') };
  fx = await billingFixture(admin, ctx);
  for (const id of [fx.tests.a]) await admin.post('/masters/test-parameters', { testId: id, code: 'P', name: 'Result', kind: 'TEXT' }).expect(201);
  await ctx.prisma.customerContact.updateMany({ where: { customerId: fx.intra.id }, data: { phone: '098765 43210' } });
  wa = ctx.app.get(WhatsappService);
});
afterAll(() => ctx.app.close());

describe('WhatsApp numbers', () => {
  it('accepts Indian mobiles however they are written, and international numbers with a code', () => {
    expect(whatsappNumber('98765 43210')).toBe('919876543210');
    expect(whatsappNumber('098765-43210')).toBe('919876543210');
    expect(whatsappNumber('+91 98765 43210')).toBe('919876543210');
    expect(whatsappNumber('0091 9876543210')).toBe('919876543210');
    expect(whatsappNumber('919876543210')).toBe('919876543210');
    expect(whatsappNumber('+44 7700 900123')).toBe('447700900123');
    expect(whatsappNumber('12345')).toBeNull();
    expect(whatsappNumber('+0 1234 5678')).toBeNull();
    expect(whatsappNumber('+91 12345 67890')).toBeNull(); // not an Indian mobile
    expect(whatsappNumber('020 2612 3456')).toBeNull(); // a landline
  });
});

describe('sending', () => {
  let jobId: string, reportId: string, invoiceId: string;

  beforeAll(async () => {
    const done = await issuedJob(ctx, team, fx.intra.id, [fx.tests.a], { P: 'OK' });
    await issue(team, done.reportId, done.version);
    jobId = done.job.id;
    reportId = done.reportId;
    const draft = (await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [jobId] }).expect(201)).body;
    invoiceId = (await accounts.post(`/invoices/${draft.id}/issue`, { version: draft.version }).expect(200)).body.id;
  }, 90000);

  it('sends an issued report with its PDF, after the sender confirms consent', async () => {
    await team.signatory.post('/whatsapp/send', { kind: 'report', entityId: reportId, to: '9876543210' }).expect(400);
    await team.signatory.post('/whatsapp/send', { kind: 'report', entityId: reportId, to: '9876543210', consent: false }).expect(400);
    await team.signatory.post('/whatsapp/send', { kind: 'report', entityId: reportId, to: '12345', consent: true }).expect(400);
    await team.signatory.post('/whatsapp/send', { kind: 'report', entityId: reportId, to: '9876543210', contactName: 'Priya', consent: true }).expect(200);
    const before = wa.sent.length;
    await drain();
    const sent = wa.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: '919876543210', template: 'lims_test_report', language: 'en' });
    expect(sent[0].document).toMatch(/^Report .*\.pdf$/);
    expect(sent[0].params[0]).toBe('Priya');
    const row = await ctx.prisma.whatsappMessage.findFirstOrThrow({ where: { entityId: reportId } });
    expect(row).toMatchObject({ status: 'SENT', consentConfirmedBy: 'signatory person', entity: 'Report' });
    expect(row.providerMessageId).toBeTruthy();
    expect(await ctx.prisma.auditLog.count({ where: { action: 'whatsapp.report.queued', entityId: reportId } })).toBe(1);
  }, 60000);

  it('refuses people who may not send that kind, and shows numbers only to those who may see customers', async () => {
    await tech.post('/whatsapp/send', { kind: 'report', entityId: reportId, to: '9876543210', consent: true }).expect(403);
    await reception.post('/whatsapp/send', { kind: 'invoice', entityId: invoiceId, to: '9876543210', consent: true }).expect(403);
    await tech.get(`/whatsapp/Job/${jobId}`).expect(403);
    await tech.get(`/whatsapp/Invoice/${invoiceId}`).expect(403);
    const signatory = (await team.signatory.get(`/whatsapp/Report/${reportId}`).expect(200)).body;
    expect(signatory.available).toBe(true);
    expect(signatory.contacts).toEqual([{ name: 'Priya', phone: '098765 43210' }]);
    expect(signatory.messages[0]).toMatchObject({ status: 'SENT', toNumber: '919876543210' });
  });

  it('renders the invoice PDF and sends it, with the amount and due date', async () => {
    await accounts.post('/whatsapp/send', { kind: 'invoice', entityId: invoiceId, to: '+91 98765 43210', consent: true }).expect(200);
    const before = wa.sent.length;
    await drain();
    const [m] = wa.sent.slice(before);
    expect(m).toMatchObject({ template: 'lims_tax_invoice', to: '919876543210' });
    expect(m.document).toMatch(/\.pdf$/);
    expect(m.params[2]).toMatch(/^₹/);
    expect(m.params[4]).toBeTruthy(); // the lab's name
    const row = await ctx.prisma.whatsappMessage.findFirstOrThrow({ where: { entityId: invoiceId, kind: 'invoice' } });
    expect(row.documentFileId).toBeTruthy();
  }, 60000);

  it('sends a payment reminder without a document and records it as a reminder', async () => {
    await accounts.post('/whatsapp/send', { kind: 'reminder', entityId: invoiceId, to: '9876543210', consent: true }).expect(200);
    const before = wa.sent.length;
    await drain();
    const [m] = wa.sent.slice(before);
    expect(m).toMatchObject({ template: 'lims_payment_reminder' });
    expect(m.document).toBeUndefined();
    expect(await ctx.prisma.reminderLog.count({ where: { invoiceId, kind: 'MANUAL' } })).toBe(1);
  });

  it('sends the samples-received letter from reception', async () => {
    await reception.post('/whatsapp/send', { kind: 'acknowledgement', entityId: jobId, to: '9876543210', consent: true }).expect(200);
    const before = wa.sent.length;
    await drain();
    const [m] = wa.sent.slice(before);
    expect(m).toMatchObject({ template: 'lims_samples_received' });
    expect(m.document).toMatch(/^Acknowledgement .*\.pdf$/);
  }, 60000);

  it('a browser cannot attach a WhatsApp message to a document request', async () => {
    await reception.post('/documents', { kind: 'job-acknowledgement', params: { jobId, whatsapp: { to: '9876543210' } } }).expect(400);
  });

  it('records a failure with its reason and lets the queue retry', async () => {
    const row = await ctx.prisma.whatsappMessage.create({
      data: {
        toNumber: '919876543210',
        kind: 'report',
        template: 'x',
        language: 'en',
        params: [],
        documentFileId: '00000000-0000-0000-0000-000000000000',
        documentName: 'gone.pdf',
        entity: 'Report',
        entityId: reportId,
      },
    });
    const original = (wa as unknown as { infra: { whatsapp: { transport: string } } }).infra.whatsapp.transport;
    (wa as unknown as { infra: { whatsapp: { transport: string } } }).infra.whatsapp.transport = 'cloud';
    try {
      await expect(wa.deliver(row.id)).rejects.toThrow();
    } finally {
      (wa as unknown as { infra: { whatsapp: { transport: string } } }).infra.whatsapp.transport = original;
    }
    const after = await ctx.prisma.whatsappMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(after.lastError).toBeTruthy();
  });
});

describe('wording order and receipts', () => {
  let reportId: string;
  const signed = (body: object, secret = 'test-app-secret') => {
    const raw = JSON.stringify(body);
    return ctx
      .http()
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)
      .send(raw);
  };
  const status = (id: string, s: string, extra: object = {}) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses: [{ id, status: s, timestamp: '1794489600', recipient_id: '919876543210', ...extra }] } }] }],
  });

  beforeAll(async () => {
    reportId = (await ctx.prisma.report.findFirstOrThrow({ where: { revisions: { some: { status: 'ISSUED' } } } })).id;
  });

  it('sends the values the lab chose, in its order', async () => {
    const s = (await admin.get('/admin/lab/whatsapp').expect(200)).body;
    await admin
      .put('/admin/lab/whatsapp/templates', { version: s.version, templates: { report: { name: 'lab_report', language: 'en', values: ['reportNo', 'sampleNo', 'customerName', 'contactName'] } } })
      .expect(200);
    await team.signatory.post('/whatsapp/send', { kind: 'report', entityId: reportId, to: '9876543210', contactName: 'Priya', consent: true }).expect(200);
    const before = wa.sent.length;
    await drain();
    const [m] = wa.sent.slice(before);
    const report = await ctx.prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { sample: true } });
    expect(m.template).toBe('lab_report');
    expect(m.params).toEqual([report.reportNo, report.sample.sampleNo, fx.intra.name.trim(), 'Priya']);
    const now = (await admin.get('/admin/lab/whatsapp').expect(200)).body;
    await admin
      .put('/admin/lab/whatsapp/templates', { version: now.version, templates: { report: { name: 'lims_test_report', language: 'en', values: ['contactName', 'reportNo', 'labName'] } } })
      .expect(200);
  });

  it('Meta proves the webhook with the verify token', async () => {
    const ok = await ctx.http().get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345').expect(200);
    expect(ok.text).toBe('12345');
    await ctx.http().get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345').expect(403);
  });

  it('moves a message to delivered then read, never backwards, and only when signed', async () => {
    const m = await ctx.prisma.whatsappMessage.findFirstOrThrow({ where: { entityId: reportId, status: 'SENT' } });
    const id = m.providerMessageId!;
    await ctx.http().post('/api/v1/webhooks/whatsapp').send(status(id, 'read')).expect(403); // unsigned
    await signed(status(id, 'read'), 'not-the-secret').expect(403);
    await signed(status(id, 'delivered')).expect(200);
    expect(await ctx.prisma.whatsappMessage.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'DELIVERED', deliveredAt: new Date(1794489600_000) });
    await signed(status(id, 'read')).expect(200);
    await signed(status(id, 'delivered')).expect(200); // late, out of order
    const after = await ctx.prisma.whatsappMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe('READ');
    expect(after.readAt).toBeTruthy();
    await signed(status('wamid.someone-else', 'read')).expect(200); // not ours: ignored
    const panel = (await team.signatory.get(`/whatsapp/Report/${reportId}`).expect(200)).body;
    expect(panel.messages.find((x: { id: string }) => x.id === m.id)).toMatchObject({ status: 'READ' });
  });

  it('records why WhatsApp could not deliver', async () => {
    const m = await ctx.prisma.whatsappMessage.findFirstOrThrow({ where: { entityId: reportId, status: 'SENT' } });
    await signed(status(m.providerMessageId!, 'failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] })).expect(200);
    const after = await ctx.prisma.whatsappMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe('FAILED');
    expect(after.lastError).toContain('131026');
  });
});

describe('administration', () => {
  it('shows the connection and lets the admin rename templates', async () => {
    await tech.get('/admin/lab/whatsapp').expect(403);
    const s = (await admin.get('/admin/lab/whatsapp').expect(200)).body;
    expect(s).toMatchObject({ configured: true, enabled: true, transport: 'json' });
    expect(s.templates.map((t: { key: string }) => t.key)).toEqual(['report', 'invoice', 'acknowledgement', 'reminder']);
    expect(s.templates[0].values).toEqual(['contactName', 'reportNo', 'labName']);
    expect(s.templates[0].available.map((v: { key: string }) => v.key)).toContain('sampleNo');
    expect(s).toMatchObject({ receipts: true, webhookUrl: 'http://api.test.example/api/v1/webhooks/whatsapp' });
    const values = ['contactName', 'reportNo', 'labName'];
    await admin.put('/admin/lab/whatsapp/templates', { version: s.version, templates: { report: { name: 'Bad Name', language: 'en', values } } }).expect(400);
    await admin.put('/admin/lab/whatsapp/templates', { version: s.version, templates: { nonsense: { name: 'x', language: 'en', values } } }).expect(400);
    await admin.put('/admin/lab/whatsapp/templates', { version: s.version, templates: { report: { name: 'x', language: 'en', values: ['contactName', 'invoiceNo'] } } }).expect(400); // not a report value
    await admin.put('/admin/lab/whatsapp/templates', { version: s.version, templates: { report: { name: 'x', language: 'en', values: ['reportNo', 'reportNo'] } } }).expect(400);
    const saved = (
      await admin
        .put('/admin/lab/whatsapp/templates', { version: s.version, templates: { report: { name: 'lab_report_v2', language: 'en_US', values: ['reportNo', 'sampleNo', 'contactName'] } } })
        .expect(200)
    ).body;
    expect(saved.templates[0]).toMatchObject({ name: 'lab_report_v2', language: 'en_US', values: ['reportNo', 'sampleNo', 'contactName'] });
    await admin.put('/admin/lab/whatsapp/templates', { version: s.version, templates: { report: { name: 'stale', language: 'en', values } } }).expect(409);
  });

  it('test-sends hello_world', async () => {
    const before = wa.sent.length;
    await admin.post('/admin/lab/whatsapp/test', { to: '9876543210' }).expect(200);
    expect(wa.sent.slice(before)[0]).toMatchObject({ template: 'hello_world', language: 'en_US', to: '919876543210' });
    await admin.post('/admin/lab/whatsapp/test', { to: 'not a number' }).expect(400);
  });

  it('turning the module off refuses sends and reports it unavailable', async () => {
    const mods = (await admin.get('/admin/lab/modules').expect(200)).body;
    expect(mods.modules.find((m: { key: string }) => m.key === 'whatsapp')).toMatchObject({ enabled: true, setupNeeded: null });
    await admin.put('/admin/lab/modules', { version: mods.version, enabled: { whatsapp: false } }).expect(200);
    const job = await ctx.prisma.job.findFirstOrThrow();
    await reception.post('/whatsapp/send', { kind: 'acknowledgement', entityId: job.id, to: '9876543210', consent: true }).expect(403);
    expect((await reception.get(`/whatsapp/Job/${job.id}`).expect(200)).body.available).toBe(false);
    expect((await reception.get('/auth/me').expect(200)).body.modules).not.toContain('whatsapp');
  });
});
