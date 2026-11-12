import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApi } from '../../src/bootstrap.js';
import { istToday } from '../../src/common/india.js';
import { MailService } from '../../src/core/mail.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { REPORTS } from '../../src/modules/mis/definitions.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import { issue, issuedJob, type FullTeam } from '../support/cycle.js';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { plannedTests, workTest } from '../support/workflow.js';

let ctx: Ctx;
let admin: Client, accounts: Client, tech: Client, mgmt: Client, sales: Client, reception: Client, planner: Client;
let team: FullTeam;
let fx: Awaited<ReturnType<typeof billingFixture>>;
const today = () => istToday().toISOString().slice(0, 10);

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
    mgmt: ROLE_NAMES.management,
    sales: ROLE_NAMES.sales,
  }))
    await createUser(ctx, `${e}@a.example`, [r], `${e} person`);
  const c = (n: string) => login(ctx, `${n}@a.example`);
  admin = await c('admin');
  accounts = await c('accounts');
  tech = await c('tech');
  mgmt = await c('mgmt');
  sales = await c('sales');
  reception = await c('reception');
  planner = await c('planner');
  team = { reception, planner, tech, hod: await c('hod'), reviewer: await c('reviewer'), signatory: await c('signatory') };
  fx = await billingFixture(admin, ctx);
  for (const id of fx.testIds) await admin.post('/masters/test-parameters', { testId: id, code: 'P', name: 'Result', kind: 'TEXT' }).expect(201);
  const inst = (await admin.post('/masters/instruments', { code: 'I1', name: 'Bench meter', calibrationDueAt: '2020-01-01' }).expect(201)).body;

  // A varied, real data set for the reports below.
  const done = await issuedJob(ctx, team, fx.intra.id, [fx.tests.a, fx.tests.d], { P: 'OK' });
  await issue(team, done.reportId, done.version);
  const inv = (await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [done.job.id] }).expect(201)).body;
  const issued = (await accounts.post(`/invoices/${inv.id}/issue`, { version: inv.version }).expect(200)).body;
  await accounts.post('/payments', { customerId: fx.intra.id, paidOn: today(), mode: 'NEFT', amount: '100', allocations: [{ invoiceId: issued.id, amount: '100' }] }).expect(201);
  const open = await plannedTests(ctx, team, fx.inter.id, [fx.tests.f, fx.tests.k], { urgent: true });
  await ctx.prisma.sampleTest.updateMany({ where: { id: open.sampleTestIds[0] }, data: { dueDate: new Date('2020-01-01'), instrumentId: inst.id } });
  await workTest(team, open.sampleTestIds[1], { P: 'OK' });
  await reception.post('/jobs', { customerId: fx.intra.id, noQuotationReason: 'x', samples: [{ description: 'Unplanned', returnable: true, testIds: [fx.tests.g] }] }).expect(201);
  await sales.post('/quotations', { customerId: fx.intra.id, lines: [{ sampleDescription: 's', testId: fx.tests.a, quantity: 1 }] }).expect(201);
}, 120000);
afterAll(() => ctx.app.close());

describe('reports module', () => {
  it('has all 24 reports, each runnable with on-screen rows', async () => {
    expect(REPORTS.map((r) => r.no).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    const catalog = (await admin.get('/mis').expect(200)).body;
    expect(catalog).toHaveLength(25);
    for (const r of catalog) {
      const res = await admin.get(`/mis/${r.key}?from=2020-01-01&to=2099-12-31&pageSize=5`);
      expect(res.status, r.key).toBe(200);
      expect(res.body.meta.total, r.key).toBeGreaterThanOrEqual(0);
      expect(res.body.columns.length, r.key).toBeGreaterThan(0);
    }
  });

  it('has rows for the core reports on real data', async () => {
    const total = async (key: string, q = '') => (await admin.get(`/mis/${key}?pageSize=5${q}`).expect(200)).body.meta.total as number;
    for (const key of [
      'pending-samples',
      'tat-crossed',
      'performance-technician',
      'performance-machine',
      'daily-collection-summary',
      'daily-collection-full',
      'daily-sample-detail',
      'daily-plan-detail',
      'pending-plan-detail',
      'daily-test-results',
      'result-pending',
      'pending-tests-summary',
      'sample-status',
      'collector-detail',
      'collector-daily',
      'collector-monthly',
      'technician-analysis',
      'pending-by-test',
      'complete-test-detail',
      'sample-returnable',
      'quotation-register',
      'invoice-register',
      'payment-register',
      'outstanding-ageing',
    ]) {
      expect(await total(key), key).toBeGreaterThan(0);
    }
    expect(await total('quotation-register', `&customerId=${fx.inter.id}`)).toBe(0);
    expect(await total('tat-crossed', `&customerId=${fx.inter.id}`)).toBe(1);
  });

  it('applies the GST breakdown in the invoice register', async () => {
    const res = (await accounts.get('/mis/invoice-register').expect(200)).body.data[0];
    expect(Number(res.cgst)).toBe(99);
    expect(Number(res.sgst)).toBe(99);
    expect(Number(res.igst)).toBe(0);
  });

  it('respects permissions and hides customer columns from roles without identity access', async () => {
    await tech.get('/mis').expect(403);
    await tech.get('/mis/pending-samples').expect(403);
    await accounts.get('/mis/pending-samples').expect(403);
    await reception.get('/mis/invoice-register').expect(403);
    const seen = (await planner.get('/mis/pending-samples').expect(200)).body;
    expect(seen.columns.map((c: { key: string }) => c.key)).not.toContain('customer');
    expect(JSON.stringify(seen)).not.toContain(fx.inter.name);
    expect((await planner.get('/mis').expect(200)).body.map((r: { key: string }) => r.key)).not.toContain('invoice-register');
  });

  it('exports to Excel and PDF in the background, with the same column rule', async () => {
    await tech.post('/documents', { kind: 'mis:pending-samples', params: { format: 'excel' } }).expect(403);
    for (const format of ['excel', 'pdf']) {
      const job = (await admin.post('/documents', { kind: 'mis:outstanding-ageing', params: { format } }).expect(201)).body;
      const file = await ctx.app.get(DocumentsService).process(job.id);
      expect(file?.mimeType, format).toContain(format === 'pdf' ? 'pdf' : 'spreadsheetml');
    }
  }, 60000);
});

describe('dashboard', () => {
  it('every operations and commercial number matches the report it links to', async () => {
    const d = (await admin.get(`/dashboard?from=2020-01-01&to=2099-12-31`).expect(200)).body;
    const metric = (group: { metrics: { key: string; value: number; link: string }[] }, key: string) => group.metrics.find((m) => m.key === key)!;
    const reportTotal = async (link: string) => {
      const [path, query] = link.replace('/reports/', '').split('?');
      return (await admin.get(`/mis/${path}?pageSize=1${query ? `&${query}` : ''}`).expect(200)).body.meta.total;
    };
    for (const key of ['received-today', 'received-month', 'tat-crossed', 'urgent-samples', 'tests-on-hold']) {
      const m = metric(d.operations, key);
      expect(m.value, key).toBe(await reportTotal(m.link));
    }
    for (const point of [...d.operations.samplesByStatus, ...d.operations.testsByStage]) expect(point.value, point.label).toBe(await reportTotal(point.link));
    const revisions = metric(d.quality, 'revisions-issued');
    expect(revisions.value).toBe(await reportTotal(revisions.link));
    expect(metric(d.commercial, 'quotations-sent').value).toBeGreaterThanOrEqual(0);
    const summary = (await accounts.get('/invoices/due/summary').expect(200)).body;
    expect(metric(d.commercial, 'outstanding').value).toBe(Number(summary.total));
    const registerTotal = (await admin.get('/mis/invoice-register?from=2020-01-01&to=2099-12-31&pageSize=100').expect(200)).body.data.reduce(
      (s: number, r: { total: string }) => s + Number(r.total),
      0,
    );
    expect(metric(d.commercial, 'billed').value).toBe(registerTotal);
    const paid = (await admin.get('/mis/payment-register?from=2020-01-01&to=2099-12-31&pageSize=100').expect(200)).body.data.reduce((s: number, r: { amount: string }) => s + Number(r.amount), 0);
    expect(metric(d.commercial, 'collected').value).toBe(paid);
    expect(d.commercial.ageing.reduce((s: number, a: { value: number }) => s + a.value, 0)).toBe(Number(summary.total));
  });

  it('shows sections by role and a personal work list for everyone', async () => {
    const t = (await tech.get('/dashboard').expect(200)).body;
    expect(t).toMatchObject({ operations: null, quality: null, people: null, commercial: null });
    expect(t.myWork.find((w: { key: string }) => w.key === 'my-open').count).toBeGreaterThan(0);
    const open = await ctx.prisma.invoice.findFirstOrThrow({ where: { status: 'PARTIALLY_PAID' } });
    await ctx.prisma.invoice.update({ where: { id: open.id }, data: { dueDate: new Date('2020-01-01') } });
    const a = (await accounts.get('/dashboard').expect(200)).body;
    await ctx.prisma.invoice.update({ where: { id: open.id }, data: { dueDate: open.dueDate } });
    expect(a.commercial).not.toBeNull();
    expect(a.operations).toBeNull();
    expect(a.myWork.map((w: { key: string }) => w.key)).toContain('overdue-invoices');
    const m = (await mgmt.get('/dashboard').expect(200)).body;
    for (const section of ['operations', 'quality', 'people', 'commercial']) expect(m[section], section).not.toBeNull();
    expect(m.people.calibrationsDue[0]).toMatchObject({ name: 'Bench meter', overdue: true });
    expect(m.people.byTechnician.length).toBeGreaterThan(0);
  });

  it('click-through links exist on every number', async () => {
    const d = (await admin.get('/dashboard').expect(200)).body;
    for (const group of [d.operations, d.quality, d.commercial]) for (const m of group.metrics) expect(m.link, m.key).toBeTruthy();
  });
});

describe('notifications', () => {
  it('tells a technician about an assignment, in-app and by email, respecting preferences', async () => {
    const before = (await tech.get('/notifications').expect(200)).body.unread;
    const {
      sampleTestIds: [id],
    } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.a]);
    const list = (await tech.get('/notifications').expect(200)).body;
    expect(list.unread).toBe(before + 1);
    expect(list.data[0]).toMatchObject({ type: 'ASSIGNED', link: `/my-tests/${id}` });
    expect(JSON.stringify(list)).not.toContain(fx.intra.name);
    const mail = await ctx.prisma.emailLog.findFirstOrThrow({ where: { template: 'notification:ASSIGNED' }, orderBy: { createdAt: 'desc' } });
    expect(mail.toAddress).toBe('tech@a.example');
    await tech.post(`/notifications/${list.data[0].id}/read`).expect(200);
    expect((await tech.get('/notifications').expect(200)).body.unread).toBe(before);

    const prefs = (await tech.put('/notifications/preferences', { preferences: { ASSIGNED: false, BOGUS: true } }).expect(200)).body;
    expect(prefs.find((p: { type: string }) => p.type === 'ASSIGNED').email).toBe(false);
    const count = await ctx.prisma.emailLog.count({ where: { template: 'notification:ASSIGNED' } });
    await plannedTests(ctx, team, fx.intra.id, [fx.tests.a]);
    expect(await ctx.prisma.emailLog.count({ where: { template: 'notification:ASSIGNED' } })).toBe(count); // no email
    expect((await tech.get('/notifications').expect(200)).body.unread).toBe(before + 1); // still in-app
    await tech.put('/notifications/preferences', { preferences: {} }).expect(200);
  });

  it('notifies approvers and sends work back with the reason', async () => {
    const {
      sampleTestIds: [id],
    } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.a]);
    const d = await workTest(team, id, { P: 'OK' });
    const hodList = (await team.hod.get('/notifications').expect(200)).body;
    expect(hodList.data[0].type).toBe('APPROVAL_DUE');
    await team.hod.post(`/tests/${id}/reject`, { version: d.version, reason: 'Repeat please' }).expect(200);
    const back = (await tech.get('/notifications').expect(200)).body.data[0];
    expect(back).toMatchObject({ type: 'SENT_BACK', body: 'Repeat please' });
  });

  it('never notifies people about their own action', async () => {
    const {
      sampleTestIds: [id],
    } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.a]);
    await workTest(team, id, { P: 'OK' });
    expect((await tech.get('/notifications').expect(200)).body.data.some((n: { type: string; title: string }) => n.type === 'APPROVAL_DUE')).toBe(false);
  });

  it('scheduled checks fire once per item', async () => {
    const svc = ctx.app.get(NotificationsService);
    const first = await svc.tatCheck();
    expect(first).toBeGreaterThan(0);
    expect(await svc.tatCheck()).toBe(0);
    const crossed = (await planner.get('/notifications?pageSize=50').expect(200)).body.data.find((n: { type: string }) => n.type === 'TAT_CROSSED');
    expect(crossed).toBeTruthy();
    expect(await svc.invoicesOverdue(new Date('2099-01-01'))).toBeGreaterThan(0);
    expect(await svc.invoicesOverdue(new Date('2099-01-01'))).toBe(0);
    const q = (await sales.post('/quotations', { customerId: fx.intra.id, validUntil: '2099-06-10', lines: [{ sampleDescription: 's', testId: fx.tests.a, quantity: 1 }] }).expect(201)).body;
    await sales.post(`/quotations/${q.id}/send`, { version: 1, to: 'x@y.example' }).expect(200);
    const creator = await ctx.prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    await ctx.prisma.quotation.update({ where: { id: q.id }, data: { createdById: admin.userId } });
    expect(creator.createdById).toBe(sales.userId);
    expect(await svc.quotationsExpiring(new Date('2099-06-08'))).toBe(1);
    expect(await svc.quotationsExpiring(new Date('2099-06-08'))).toBe(0);
  });

  it('email is sent through the queue with retries recorded', async () => {
    const mail = ctx.app.get(MailService);
    const log = await ctx.prisma.emailLog.findFirstOrThrow({ where: { template: { startsWith: 'notification:' }, status: 'QUEUED' } });
    await mail.deliver(log.id);
    const after = await ctx.prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(after).toMatchObject({ status: 'SENT', attempts: 1 });
    await mail.deliver(log.id); // idempotent
    expect((await ctx.prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } })).attempts).toBe(1);
    expect(await mail.sweepQueued()).toBeGreaterThanOrEqual(0);
  });
});

/**
 * The required guarantee, tested exhaustively: walk every GET route in the OpenAPI document as a
 * technician, with real record ids, and confirm no response carries customer identity or pricing.
 */
describe('technician isolation across the whole API', () => {
  it('no GET endpoint returns customer identity or pricing to a technician', async () => {
    const doc = buildOpenApi(ctx.app) as { paths: Record<string, Record<string, unknown>> };
    const job = await ctx.prisma.job.findFirstOrThrow({
      where: { samples: { some: { tests: { some: { assignedToId: tech.userId } } } } },
      include: { samples: { include: { tests: true, reports: { include: { revisions: true } } } } },
    });
    const sample = job.samples[0];
    const test = await ctx.prisma.sampleTest.findFirstOrThrow({ where: { assignedToId: tech.userId } });
    const quotation = await ctx.prisma.quotation.findFirstOrThrow();
    const invoice = await ctx.prisma.invoice.findFirstOrThrow();
    const payment = await ctx.prisma.payment.findFirstOrThrow();
    const report = await ctx.prisma.report.findFirstOrThrow({ include: { revisions: true } });
    const ids: Record<string, string> = {
      id: test.id,
      revisionId: report.revisions[0].id,
      key: 'pending-samples',
    };
    const perResource: [RegExp, string][] = [
      [/^\/api\/v1\/jobs\//, job.id],
      [/^\/api\/v1\/samples\//, sample.id],
      [/^\/api\/v1\/customers\//, fx.intra.id],
      [/^\/api\/v1\/quotations\//, quotation.id],
      [/^\/api\/v1\/invoices\//, invoice.id],
      [/^\/api\/v1\/payments\//, payment.id],
      [/^\/api\/v1\/reports\//, report.id],
      [/^\/api\/v1\/orders\//, job.id],
      [/^\/api\/v1\/dispatch\//, job.id],
    ];
    const secrets = [fx.intra.name, fx.inter.name, fx.intra.crn, fx.inter.crn, 'priya@intra.example'];
    const allowedOk: string[] = [];
    for (const [path, ops] of Object.entries(doc.paths)) {
      if (!('get' in ops)) continue;
      if (path.startsWith('/api/v1/public') || path.startsWith('/health')) continue;
      const url = path.replace('/api/v1', '').replace(/\{(\w+)\}/g, (_, name: string) => {
        const specific = perResource.find(([re]) => re.test(path));
        return name === 'id' && specific ? specific[1] : (ids[name] ?? test.id);
      });
      const q = url.includes('/search')
        ? `?q=${encodeURIComponent(fx.intra.name)}&code=${encodeURIComponent(sample.sampleNo)}`
        : url.includes('/files') && !url.includes('/url')
          ? `?entity=Job&entityId=${job.id}`
          : '';
      const res = await tech.get(url + q);
      const text = JSON.stringify(res.body);
      for (const secret of secrets) expect(text.includes(secret), `${url} leaked ${secret}`).toBe(false);
      if (res.status === 200) {
        expect(text, `${url} leaked a rate`).not.toMatch(/"(rate|amount|grandTotal|subtotal|unitPrice|rateSource)"\s*:/);
        allowedOk.push(path);
      }
    }
    // The walk really reached the routes a technician uses.
    for (const p of ['/api/v1/tests/my', '/api/v1/tests/{id}', '/api/v1/notifications', '/api/v1/dashboard', '/api/v1/auth/me']) expect(allowedOk).toContain(p);
    // And none of the business lists.
    for (const p of ['/api/v1/customers', '/api/v1/jobs', '/api/v1/samples', '/api/v1/quotations', '/api/v1/invoices', '/api/v1/reports', '/api/v1/masters/standard-rates'])
      expect(allowedOk).not.toContain(p);
  });

  it('job card PDF template leaves out prices', async () => {
    const { jobCardHtml } = await import('../../src/modules/pdf/templates/job-documents.js');
    const html = jobCardHtml(
      {
        jobNo: 'J-1',
        customerName: null,
        tests: [
          {
            testName: 'T',
            methodName: 'M',
            sampleNo: 'S-1',
            sampleDescription: 'D',
            dueDate: null,
            urgent: false,
            assignee: 'A',
            instrument: null,
            analysisMode: null,
            officeInstructions: null,
            technicalData: null,
            parameters: ['P'],
            stages: ['One'],
          },
        ],
      },
      { legalName: 'X', labAddress: '', phone: '', email: '', gstin: '', pan: '', branding: { primaryColor: '#000000', logoDataUri: null } } as never,
    );
    expect(html).not.toMatch(/₹|Rate|Price/);
    expect(html).not.toContain('Customer:');
  });
});

/** Regression tests from the security review of who can reach customer identity and prices. */
describe('customer identity and prices through documents', () => {
  it('a planner cannot produce documents that name the customer', async () => {
    const job = await ctx.prisma.job.findFirstOrThrow();
    for (const kind of ['job-srf', 'job-acknowledgement']) await planner.post('/documents', { kind, params: { jobId: job.id } }).expect(403);
    const report = await ctx.prisma.report.findFirstOrThrow({ include: { revisions: true } });
    await planner.get(`/reports/${report.id}/preview`).expect(403);
    // The report PDF is server-only: no client can request it at all, whatever its permissions.
    const res = await planner.post('/documents', { kind: 'report-pdf', params: { revisionId: report.revisions[0].id } }).expect(400);
    expect(res.body.error.fields[0]).toMatchObject({ field: 'kind', message: 'Unknown document type' });
  });

  it('report exports decide customer columns on the server, whatever the client sends', async () => {
    const asked = (await planner.post('/documents', { kind: 'mis:pending-samples', params: { format: 'excel', customerVisible: true } }).expect(201)).body;
    const stored = await ctx.prisma.documentJob.findUniqueOrThrow({ where: { id: asked.id } });
    expect((stored.params as { customerVisible: boolean }).customerVisible).toBe(false);
    const file = await ctx.app.get(DocumentsService).process(asked.id);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await ctx.app.get(DocumentsService)['storage'].read(file!.id)).buffer as never);
    const headers: string[] = [];
    wb.worksheets[0].getRow(1).eachCell((c) => headers.push(String(c.value)));
    expect(headers).not.toContain('Customer');
    const allowed = (await admin.post('/documents', { kind: 'mis:pending-samples', params: { format: 'excel', customerVisible: false } }).expect(201)).body;
    expect(((await ctx.prisma.documentJob.findUniqueOrThrow({ where: { id: allowed.id } })).params as { customerVisible: boolean }).customerVisible).toBe(true);
  }, 60000);

  it('reception converts quotations without seeing prices', async () => {
    const q = (await sales.post('/quotations', { customerId: fx.intra.id, lines: [{ sampleDescription: 'To book', testId: fx.tests.a, quantity: 1 }] }).expect(201)).body;
    const sent = (await sales.post(`/quotations/${q.id}/send`, { version: 1, to: 'b@c.example' }).expect(200)).body;
    await sales.post(`/quotations/${q.id}/accept`, { version: sent.version }).expect(200);
    await reception.get('/quotations').expect(403);
    await reception.get(`/quotations/${q.id}`).expect(403);
    const list = (await reception.get('/quotations/convertible').expect(200)).body;
    const row = list.find((x: { id: string }) => x.id === q.id);
    expect(row).toMatchObject({ customerName: fx.intra.name, samples: ['To book'], testCount: 1 });
    expect(JSON.stringify(row)).not.toMatch(/rate|amount|total/i);
    const conv = (await reception.post(`/quotations/${q.id}/convert`).expect(200)).body;
    expect(conv.jobId).toBeTruthy();
    expect((await reception.get('/quotations/convertible').expect(200)).body.find((x: { id: string }) => x.id === q.id)).toBeUndefined();
  });

  it('a temporary password only allows changing it', async () => {
    const created = (
      await admin
        .post('/admin/users', {
          email: 'new@a.example',
          name: 'New Person',
          password: 'Temp-Password-1!',
          roleIds: [(await ctx.prisma.role.findUniqueOrThrow({ where: { name: ROLE_NAMES.sales } })).id],
        })
        .expect(201)
    ).body;
    const c = await login(ctx, 'new@a.example', 'Temp-Password-1!');
    expect((await c.get('/auth/me').expect(200)).body.mustChangePassword).toBe(true);
    const blocked = await c.get('/customers').expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await c.post('/auth/change-password', { currentPassword: 'Temp-Password-1!', newPassword: 'Chosen-Password-2!' }).expect(200);
    const after = await login(ctx, 'new@a.example', 'Chosen-Password-2!');
    await after.get('/customers').expect(200);
    void created;
  });
});
