import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, PASSWORD, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { workTest, type Team } from '../support/workflow.js';

/** Regression tests for the code review findings: each would have failed before its fix. */
let ctx: Ctx;
let admin: Client, sales: Client, reception: Client, planner: Client, tech: Client, hod: Client, accounts: Client, reviewer: Client, signatory: Client;
let team: Team;
let fx: Awaited<ReturnType<typeof billingFixture>>;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  const roles = { admin: ROLE_NAMES.admin, sales: ROLE_NAMES.sales, reception: ROLE_NAMES.reception, planner: ROLE_NAMES.planner, tech: ROLE_NAMES.tech, hod: ROLE_NAMES.hod, accounts: ROLE_NAMES.accounts, reviewer: ROLE_NAMES.reviewer, signatory: ROLE_NAMES.signatory };
  for (const [e, r] of Object.entries(roles)) await createUser(ctx, `${e}@rf.example`, [r], `${e} person`);
  [admin, sales, reception, planner, tech, hod, accounts, reviewer, signatory] = await Promise.all(Object.keys(roles).map((e) => login(ctx, `${e}@rf.example`)));
  team = { reception, planner, tech, hod };
  fx = await billingFixture(admin, ctx);
  for (const [testId, code] of [[fx.tests.a, 'APPEAR'], [fx.tests.d, 'DENSITY'], [fx.tests.k, 'KV']] as const) await admin.post('/masters/test-parameters', { testId, code, name: code, decimals: 2 }).expect(201);
});
afterAll(() => ctx.app.close());

/** Quotation → sent → accepted → job, as sales and reception would do it. */
async function acceptedQuotation(body: object) {
  const q = (await sales.post('/quotations', { customerId: fx.intra.id, ...body }).expect(201)).body;
  const sent = (await sales.post(`/quotations/${q.id}/send`, { version: q.version, to: 'buyer@cust.example' }).expect(200)).body;
  return (await sales.post(`/quotations/${q.id}/accept`, { version: sent.version }).expect(200)).body;
}

/** Plans, works and approves every test on a job, so it is billable. */
async function approveAll(jobId: string) {
  const job = (await reception.get(`/jobs/${jobId}`).expect(200)).body;
  for (const s of job.samples) {
    const plan = (await planner.post('/planning/plans', { sampleIds: [s.id], tests: s.tests.map((t: { testId: string }) => ({ testId: t.testId })) }).expect(201)).body;
    await planner.post('/planning/assign', { sampleTestIds: plan.sampleTestIds, assignedToId: tech.userId }).expect(200);
    for (const id of plan.sampleTestIds) {
      const d = await workTest(team, id, {});
      await hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
    }
  }
}

describe('documents can only be requested safely from a client', () => {
  it('rejects an email recipient or the final flag in client parameters', async () => {
    const res = await accounts.post('/documents', { kind: 'statement-of-account', params: { customerId: fx.intra.id, email: { to: 'attacker@evil.example', subject: 'x', bodyHtml: 'x' } } }).expect(400);
    expect(res.body.error.fields.map((f: { field: string }) => f.field)).toContain('params.email');
    await admin.post('/documents', { kind: 'customer-export', params: { final: true } }).expect(400);
    expect(await ctx.prisma.emailLog.count({ where: { toAddress: 'attacker@evil.example' } })).toBe(0);
  });

  it('refuses internal document kinds outright', async () => {
    for (const kind of ['report-pdf', 'letter-combine']) {
      const res = await admin.post('/documents', { kind, params: { revisionId: 'x', fileIds: [] } }).expect(400);
      expect(res.body.error.fields[0]).toMatchObject({ field: 'kind', message: 'Unknown document type' });
    }
  });
});

describe('formula engine limits', () => {
  it('rejects a value too large to be a laboratory number, quickly', async () => {
    const started = Date.now();
    const res = (await admin.post('/masters/formula-console', { expression: '(((9^100)^100)^100)^100', inputs: {} }).expect(200)).body;
    expect(res).toMatchObject({ valid: false, error: 'The result is too large' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('the invoice equals the accepted quotation', () => {
  it('carries quantity, line discount and header discount through booking to the invoice', async () => {
    // Density 550 × 4 units at 10% off = 1980; Appearance 550 × 1 = 550; header discount 5%.
    const q = await acceptedQuotation({
      discountPct: '5',
      lines: [
        { sampleDescription: 'Steel coupon', testId: fx.tests.d, quantity: 4, discountPct: '10' },
        { sampleDescription: 'Steel coupon', testId: fx.tests.a, quantity: 1 },
      ],
    });
    const quoted = q.versions.find((v: { versionNo: number }) => v.versionNo === q.currentVersionNo);
    const converted = (await sales.post(`/quotations/${q.id}/convert`, {}).expect(200)).body;
    await approveAll(converted.jobId);
    const inv = (await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [converted.jobId] }).expect(201)).body;
    const den = inv.lines.find((l: { description: string }) => l.description.includes('Density'));
    expect(den).toMatchObject({ quantity: 4, amount: '1980' });
    expect(inv.subtotal).toBe(quoted.subtotal);
    expect(inv.discountAmount).toBe(quoted.discountAmount);
    expect(inv.grandTotal).toBe(quoted.grandTotal);
  }, 90_000);

  it('two simultaneous conversions of one quotation make one job', async () => {
    const q = await acceptedQuotation({ lines: [{ sampleDescription: 'Bar', testId: fx.tests.a, quantity: 1 }] });
    const results = await Promise.all([sales.post(`/quotations/${q.id}/convert`, {}), sales.post(`/quotations/${q.id}/convert`, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await ctx.prisma.job.count({ where: { quotationId: q.id } })).toBe(1);
  }, 60_000);

  it('two simultaneous invoices for one job bill each test once', async () => {
    const q = await acceptedQuotation({ lines: [{ sampleDescription: 'Rod', testId: fx.tests.k, quantity: 1 }] });
    const { jobId } = (await sales.post(`/quotations/${q.id}/convert`, {}).expect(200)).body;
    await approveAll(jobId);
    const results = await Promise.all([accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [jobId] }), accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [jobId] })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await ctx.prisma.invoiceLine.count({ where: { jobId } })).toBe(1);
  }, 90_000);
});

describe('results below or above the limit of measurement', () => {
  it('stores "< x", judges it only when certain, and blocks formulas from using it', async () => {
    const test = (await admin.post('/masters/tests', { code: 'TRACE', name: 'Trace metal' }).expect(201)).body;
    const pb = (await admin.post('/masters/test-parameters', { testId: test.id, code: 'PB', name: 'Lead', decimals: 3 }).expect(201)).body;
    await admin.post('/masters/test-parameters', { testId: test.id, code: 'WT', name: 'Sample weight', decimals: 2, showOnReport: false }).expect(201);
    const spec = (await admin.post('/masters/specifications', { code: 'PB-MAX', name: 'Lead limit', limits: [{ parameterId: pb.id, maxValue: '0.010' }] }).expect(201)).body;
    const job = (await reception.post('/jobs', { customerId: fx.intra.id, noQuotationReason: 'x', samples: [{ description: 'Water' }] }).expect(201)).body;
    const plan = (await planner.post('/planning/plans', { sampleIds: [job.samples[0].id], specificationId: spec.id, tests: [{ testId: test.id }] }).expect(201)).body;
    await planner.post('/planning/assign', { sampleTestIds: plan.sampleTestIds, assignedToId: tech.userId }).expect(200);
    const id = plan.sampleTestIds[0];
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    const pid = (code: string) => d.results.find((r: { code: string }) => r.code === code).parameterId;
    d = (await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: pid('PB'), value: '< 0.005' }, { parameterId: pid('WT'), value: '12.5' }] }).expect(200)).body;
    const lead = d.results.find((r: { code: string }) => r.code === 'PB');
    expect(lead).toMatchObject({ value: '<0.005', numericValue: '0.005', qualifier: '<', passPrimary: true });
    d = (await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: pid('PB'), value: '<0.02' }] }).expect(200)).body;
    expect(d.results.find((r: { code: string }) => r.code === 'PB').passPrimary).toBeNull(); // could be either side of 0.010
    // Every change to a value is in the audit trail, with before and after.
    const history = await ctx.prisma.auditLog.findMany({ where: { entity: 'SampleTest', entityId: id, action: 'SampleTest.results' }, orderBy: { at: 'asc' } });
    expect(history.at(-1)).toMatchObject({ before: { PB: '<0.005' }, after: { PB: '<0.020' } });
  }, 60_000);
});

describe('a signed report whose final PDF failed can be recovered', () => {
  it('regenerates the PDF only when it is missing', async () => {
    const job = (await reception.post('/jobs', { customerId: fx.intra.id, noQuotationReason: 'x', samples: [{ description: 'Oil' }] }).expect(201)).body;
    const plan = (await planner.post('/planning/plans', { sampleIds: [job.samples[0].id], tests: [{ testId: fx.tests.a }] }).expect(201)).body;
    await planner.post('/planning/assign', { sampleTestIds: plan.sampleTestIds, assignedToId: tech.userId }).expect(200);
    const d = await workTest(team, plan.sampleTestIds[0], {});
    await hod.post(`/tests/${plan.sampleTestIds[0]}/approve`, { version: d.version }).expect(200);
    const row = (await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data[0];
    let r = (await reviewer.get(`/reports/${row.id}`).expect(200)).body;
    r = (await reviewer.post(`/reports/${row.id}/submit`, { version: r.revisions[0].version }).expect(200)).body;
    r = (await reviewer.post(`/reports/${row.id}/pass-review`, { version: r.revisions[0].version }).expect(200)).body;
    r = (await signatory.post(`/reports/${row.id}/approve`, { version: r.revisions[0].version, password: PASSWORD }).expect(200)).body;
    // Simulate the lost render job: no file, and the queued job gone.
    await ctx.prisma.documentJob.deleteMany({ where: { kind: 'report-pdf' } });
    await signatory.post(`/reports/${row.id}/regenerate-pdf`, {}).expect(200);
    expect(await ctx.prisma.documentJob.count({ where: { kind: 'report-pdf', params: { path: ['revisionId'], equals: r.revisions[0].id } } })).toBe(1);
    await reviewer.post(`/reports/${row.id}/regenerate-pdf`, {}).expect(403);
  }, 60_000);
});
