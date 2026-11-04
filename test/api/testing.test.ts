import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { plannedTests, workTest, type Team } from '../support/workflow.js';

let ctx: Ctx;
let admin: Client, sales: Client, reception: Client, planner: Client, tech: Client, tech2: Client, hod: Client;
let team: Team;
let fx: Awaited<ReturnType<typeof billingFixture>>;
let tensile: { id: string };
let densityParam: string;
let spec: { id: string }, dual: { id: string };

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  const { loadBaseline } = await import('../../src/modules/rbac/baseline.js');
  await ctx.prisma.$transaction(loadBaseline);
  for (const [e, r] of Object.entries({ admin: ROLE_NAMES.admin, sales: ROLE_NAMES.sales, reception: ROLE_NAMES.reception, planner: ROLE_NAMES.planner, tech: ROLE_NAMES.tech, tech2: ROLE_NAMES.tech, hod: ROLE_NAMES.hod })) await createUser(ctx, `${e}@t.example`, [r], `${e} name`);
  admin = await login(ctx, 'admin@t.example');
  sales = await login(ctx, 'sales@t.example');
  reception = await login(ctx, 'reception@t.example');
  planner = await login(ctx, 'planner@t.example');
  tech = await login(ctx, 'tech@t.example');
  tech2 = await login(ctx, 'tech2@t.example');
  hod = await login(ctx, 'hod@t.example');
  team = { reception, planner, tech, hod };
  fx = await billingFixture(admin, ctx);
  densityParam = (await admin.post('/masters/test-parameters', { testId: fx.tests.d, code: 'DENSITY', name: 'Density', decimals: 3, accredited: true }).expect(201)).body.id;
  await admin.post('/masters/test-parameters', { testId: fx.tests.a, code: 'APPEAR', name: 'Appearance', kind: 'TEXT' }).expect(201);
  spec = (await admin.post('/masters/specifications', { code: 'SPEC-1', name: 'Spec 1', limits: [{ parameterId: densityParam, minValue: '0.8', maxValue: '0.9' }] }).expect(201)).body;
  dual = (await admin.post('/masters/specifications', { code: 'SPEC-2', name: 'Spec 2', limits: [{ parameterId: densityParam, minValue: '0.85' }] }).expect(201)).body;

  tensile = (await admin.post('/masters/tests', { code: 'TENS', name: 'Tensile', category: 'MECHANICAL' }).expect(201)).body;
  const formulas = (await admin.get('/masters/formulas?pageSize=50').expect(200)).body.data;
  const f = (code: string) => formulas.find((x: { code: string }) => x.code === code).id;
  const p = (body: object) => admin.post('/masters/test-parameters', { testId: tensile.id, ...body }).expect(201);
  await p({ code: 'W', name: 'Width', sortOrder: 1 });
  await p({ code: 'T', name: 'Thickness', sortOrder: 2 });
  await p({ code: 'LOAD', name: 'Max load', sortOrder: 3, decimals: 0 });
  await p({ code: 'A0', name: 'Area', kind: 'CALCULATED', formulaId: f('AREA_RECT'), formulaBindings: { width: 'W', thickness: 'T' }, decimals: 3, sortOrder: 4 });
  await p({ code: 'UTS', name: 'UTS', kind: 'CALCULATED', formulaId: f('UTS'), formulaBindings: { max_load: 'LOAD', original_area: 'A0' }, sortOrder: 5 });
});
afterAll(() => ctx.app.close());

describe('technician worklist', () => {
  it('shows assigned tests only, urgent first, without customer or price', async () => {
    const a = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    const b = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d], { urgent: true });
    const list = (await tech.get('/tests/my').expect(200)).body;
    expect(list.data[0].id).toBe(b.sampleTestIds[0]);
    expect(list.data.map((d: { id: string }) => d.id)).toContain(a.sampleTestIds[0]);
    expect((await tech2.get('/tests/my').expect(200)).body.data).toEqual([]);
    const text = JSON.stringify(list);
    expect(text).not.toContain(fx.intra.name);
    expect(list.data[0].customerName).toBeNull();
    expect(list.data[0]).not.toHaveProperty('rate');
    expect(list.data[0].jobNo).toBeTruthy();
    await sales.get('/tests/my').expect(403);
  });

  it('another technician cannot read or touch the test, and gets not-found', async () => {
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    await tech2.get(`/tests/${id}`).expect(404);
    await tech2.post(`/tests/${id}/start`, { version: 2 }).expect(403);
    await tech2.get(`/tests/${id}/history`).expect(404);
  });

  it('never leaks customer identity or rate in the detail response', async () => {
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    const d = (await tech.get(`/tests/${id}`).expect(200)).body;
    const text = JSON.stringify(d);
    expect(text).not.toContain(fx.intra.name);
    expect(text).not.toContain(fx.intra.crn);
    expect(text).not.toMatch(/"rate"/);
    expect(d.customerName).toBeNull();
  });

  it('shows the customer when the impartiality control is off', async () => {
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    await admin.put('/admin/settings/controls.impartiality', { value: false, version: 0, reason: 'Small lab' }).expect(200);
    expect((await tech.get(`/tests/${id}`).expect(200)).body.customerName).toBe(fx.intra.name);
    await admin.put('/admin/settings/controls.impartiality', { value: true, version: 1, reason: 'Restored' }).expect(200);
    expect((await tech.get(`/tests/${id}`).expect(200)).body.customerName).toBeNull();
  });
});

describe('stages and results', () => {
  it('runs in order, records who and when, and rolls status up to the job', async () => {
    const { job, sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    expect(d.status).toBe('ASSIGNED');
    await tech.put(`/tests/${id}/results`, { version: d.version, values: [] }).expect(422);
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    expect(d.status).toBe('IN_PROGRESS');
    expect(d.conductedByName).toBe('tech name'); // filled from the logged-in user
    expect((await reception.get(`/jobs/${job.id}`).expect(200)).body.status).toBe('IN_TESTING');
    await tech.post(`/tests/${id}/stages/2/complete`, { version: d.version }).expect(422); // out of order
    d = (await tech.post(`/tests/${id}/stages/0/complete`, { version: d.version }).expect(200)).body;
    expect(d.stages[0]).toMatchObject({ completedByName: 'tech name' });
    expect(d.stages[0].completedAt).toBeTruthy();
    expect(d.currentStage).toBe('Sample Preparation');
    await tech.post(`/tests/${id}/stages/0/complete`, { version: d.version }).expect(422);
    await tech.post(`/tests/${id}/stages/1/complete`, { version: 1 }).expect(409); // stale
  });

  it('calculates server-side, shows working, and stores the formula version on submit', async () => {
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [tensile.id]);
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    const byCode = (code: string) => d.results.find((r: { code: string }) => r.code === code);
    d = (await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: byCode('W').parameterId, value: '12.5' }] }).expect(200)).body;
    expect(byCode('UTS').numericValue).toBeNull();
    expect(byCode('A0').error).toContain('Waiting');
    d = (await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: byCode('T').parameterId, value: '10' }, { parameterId: byCode('LOAD').parameterId, value: '62500' }] }).expect(200)).body;
    expect(byCode('A0').numericValue).toBe('125.000');
    expect(byCode('UTS').numericValue).toBe('500.00');
    expect(byCode('UTS').calculation.working).toContain('62500 / 125');
    // A client cannot set a calculated value directly.
    d = (await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: byCode('UTS').parameterId, value: '9999' }] }).expect(200)).body;
    expect(byCode('UTS').numericValue).toBe('500.00');
    for (const s of d.stages) d = (await tech.post(`/tests/${id}/stages/${s.seq}/complete`, { version: d.version }).expect(200)).body;
    d = (await tech.post(`/tests/${id}/submit`, { version: d.version }).expect(200)).body;
    expect(d.status).toBe('RESULTS_SUBMITTED');
    expect(byCode('UTS').calculation).toMatchObject({ formulaVersion: 1 });
    const record = await ctx.prisma.calculationRecord.findFirstOrThrow({ where: { parameterResult: { sampleTestId: id, code: 'UTS' } }, include: { formulaVersion: { include: { formula: true } } } });
    expect(record.formulaVersion.formula.code).toBe('UTS');
    expect(record.inputs).toEqual({ max_load: '62500', original_area: '125.000' });
  });

  it('checks pass and fail against both grades', async () => {
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d], { specificationId: spec.id, dualSpecificationId: dual.id });
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    d = (await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: densityParam, value: '0.82' }] }).expect(200)).body;
    expect(d.results[0]).toMatchObject({ numericValue: '0.820', passPrimary: true, passDual: false });
    expect(d.results[0].limits.map((l: { spec: string }) => l.spec)).toEqual(['SPEC-1', 'SPEC-2']);
    expect(d.outcome).toBe('FAIL');
  });

  it('refuses to submit with missing results or incomplete stages', async () => {
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    const r1 = await tech.post(`/tests/${id}/submit`, { version: d.version }).expect(422);
    expect(r1.body.error.code).toBe('STAGES_INCOMPLETE');
    for (const s of d.stages) d = (await tech.post(`/tests/${id}/stages/${s.seq}/complete`, { version: d.version }).expect(200)).body;
    const r2 = await tech.post(`/tests/${id}/submit`, { version: d.version }).expect(422);
    expect(r2.body.error.code).toBe('RESULTS_MISSING');
    expect(r2.body.error.message).toContain('Density');
  });

  it('warns on an overdue instrument and blocks it only when the setting requires', async () => {
    const inst = (await admin.post('/masters/instruments', { code: 'OLD-1', name: 'Old balance', calibrationDueAt: '2020-01-01' }).expect(201)).body;
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    d = (await tech.put(`/tests/${id}/results`, { version: d.version, instrumentId: inst.id }).expect(200)).body;
    expect(d.instrumentWarning).toContain('Old balance');
    expect(d.instruments.find((i: { id: string }) => i.id === inst.id).calibrationOverdue).toBe(true);
    const s = (await admin.get('/admin/settings').expect(200)).body.find((x: { key: string }) => x.key === 'controls.blockOverdueInstruments');
    await admin.put('/admin/settings/controls.blockOverdueInstruments', { value: true, version: s.version }).expect(200);
    const blocked = await tech.put(`/tests/${id}/results`, { version: d.version, instrumentId: inst.id }).expect(422);
    expect(blocked.body.error.code).toBe('INSTRUMENT_OVERDUE');
    await admin.put('/admin/settings/controls.blockOverdueInstruments', { value: false, version: s.version + 1 }).expect(200);
  });

  it('holds with a reason, blocks work, and releases to the earlier status', async () => {
    const { job, sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    await tech.post(`/tests/${id}/hold`, { version: d.version, reason: '' }).expect(400);
    d = (await tech.post(`/tests/${id}/hold`, { version: d.version, reason: 'Reagent out' }).expect(200)).body;
    expect(d).toMatchObject({ status: 'ON_HOLD', holdReason: 'Reagent out' });
    await tech.post(`/tests/${id}/submit`, { version: d.version }).expect(422);
    d = (await tech.post(`/tests/${id}/release`, { version: d.version }).expect(200)).body;
    expect(d.status).toBe('IN_PROGRESS');
    // A held job stops the bench too
    const j = (await reception.get(`/jobs/${job.id}`).expect(200)).body;
    await reception.post(`/jobs/${job.id}/hold`, { version: j.version, reason: 'Customer query' }).expect(200);
    const blocked = await tech.put(`/tests/${id}/results`, { version: d.version, values: [] }).expect(422);
    expect(blocked.body.error.code).toBe('JOB_ON_HOLD');
  });

  it('offers remark suggestions from the outcome and conversions without masters access', async () => {
    await admin.post('/masters/remark-templates', { code: 'OK', text: 'Meets the spec', outcome: 'PASS' }).expect(201);
    await admin.post('/masters/remark-templates', { code: 'BAD', text: 'Fails the spec', outcome: 'FAIL' }).expect(201);
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d], { specificationId: spec.id });
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    d = (await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: densityParam, value: '0.85' }], remarks: 'Tested as received', observations: 'Clear', notes: 'None' }).expect(200)).body;
    expect(d.outcome).toBe('PASS');
    expect(d.remarkOptions.find((r: { code: string }) => r.code === 'OK').suggested).toBe(true);
    expect(d.remarkOptions.find((r: { code: string }) => r.code === 'BAD').suggested).toBe(false);
    expect(d).toMatchObject({ remarks: 'Tested as received', observations: 'Clear', notes: 'None' });
    expect(d.conversions.length).toBeGreaterThan(0);
    const conv = d.conversions.find((c: { fromCode: string }) => c.fromCode === 'PSI');
    expect((await tech.post('/masters/convert', { conversionId: conv.id, value: '2500' }).expect(200)).body.value).toBe('2.5000');
  });

  it('lets the assignee attach files with a print size until the test is submitted', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    const attach = (c: Client) => c.post('/files').field('entity', 'SampleTest').field('entityId', id).field('category', 'result-image').field('printWidthMm', '80').field('printHeightMm', '60').attach('file', PNG, 'micro.png');
    await attach(tech).expect(403); // not started
    const d = (await tech.get(`/tests/${id}`).expect(200)).body;
    await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200);
    const f = (await attach(tech).expect(201)).body;
    expect(f).toMatchObject({ printWidthMm: 80, printHeightMm: 60 });
    await attach(tech2).expect(403);
    await workTest(team, id, { DENSITY: '0.85' });
    await attach(tech).expect(403); // locked
    await tech.get(`/files/${f.id}/url`).expect(200);
    await tech2.get(`/files/${f.id}/url`).expect(403);
    await hod.get(`/files/${f.id}/url`).expect(200);
  });
});

describe('bad entries', () => {
  it('refuses a non-numeric result instead of storing it as blank', async () => {
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    const res = await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: densityParam, value: 'abc' }] }).expect(400);
    expect(res.body.error.code).toBe('RESULT_INVALID');
    expect(res.body.error.fields[0]).toMatchObject({ field: densityParam, message: 'Not a number' });
    for (const value of ['1e20', '1e999', '-1e13']) {
      const big = await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: densityParam, value }] });
      expect(big.status, value).toBe(400);
    }
    expect((await tech.get(`/tests/${id}`).expect(200)).body.assignedToMe).toBe(true);
  });
});

describe('HoD approval', () => {
  it('approves, locks results, and reject returns to the analyst with the reason', async () => {
    const { job, sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    let d = await workTest(team, id, { DENSITY: '0.85' });
    const queue = (await hod.get('/tests/approvals').expect(200)).body;
    const item = queue.data.find((q: { id: string }) => q.id === id);
    expect(item.results[0].numericValue).toBe('0.850');
    expect(JSON.stringify(queue)).not.toContain(fx.intra.name);
    await tech.post(`/tests/${id}/approve`, { version: d.version }).expect(403);
    await hod.post(`/tests/${id}/reject`, { version: d.version, reason: '' }).expect(400);
    d = (await hod.post(`/tests/${id}/reject`, { version: d.version, reason: 'Repeat the density' }).expect(200)).body;
    expect(d).toMatchObject({ status: 'IN_PROGRESS', rejectionReason: 'Repeat the density' });
    expect((await tech.get('/tests/my').expect(200)).body.data.find((t: { id: string }) => t.id === id).rejectionReason).toBe('Repeat the density');
    d = await workTest(team, id, { DENSITY: '0.86' });
    await hod.post(`/tests/${id}/approve`, { version: 1 }).expect(409);
    d = (await hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200)).body;
    expect(d.status).toBe('APPROVED');
    expect(d.approvedByName).toBe('hod name');
    expect(d.rejectionReason).toBeNull();
    // Locked: no further changes by anyone
    await tech.put(`/tests/${id}/results`, { version: d.version, values: [{ parameterId: densityParam, value: '1' }] }).expect(422);
    await tech.post(`/tests/${id}/hold`, { version: d.version, reason: 'x' }).expect(422);
    await hod.post(`/tests/${id}/reject`, { version: d.version, reason: 'x' }).expect(403);
    expect((await reception.get(`/jobs/${job.id}`).expect(200)).body.status).toBe('REPORTING');
  });

  it('separation of duties: nobody approves their own results unless Admin relaxes it, and that is audited', async () => {
    const both = await createUser(ctx, 'both@t.example', [ROLE_NAMES.tech, ROLE_NAMES.hod], 'Both Roles');
    const c = await login(ctx, 'both@t.example');
    const job = (await reception.post('/jobs', { customerId: fx.intra.id, noQuotationReason: 'x', samples: [{ description: 'x' }] }).expect(201)).body;
    const plan = (await planner.post('/planning/plans', { sampleIds: [job.samples[0].id], tests: [{ testId: fx.tests.d }] }).expect(201)).body;
    const id = plan.sampleTestIds[0];
    await planner.post('/planning/assign', { sampleTestIds: [id], assignedToId: both.id }).expect(200);
    const d = await workTest({ ...team, tech: c }, id, { DENSITY: '0.85' });
    const res = await c.post(`/tests/${id}/approve`, { version: d.version }).expect(403);
    expect(res.body.error.code).toBe('SELF_APPROVAL');
    const q = (await c.get('/tests/approvals').expect(200)).body.data.find((x: { id: string }) => x.id === id);
    expect(q.ownResult).toBe(true);
    await admin.put('/admin/settings/controls.allowSelfApproval', { value: true, version: 0, reason: 'One-person lab' }).expect(200);
    await c.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
    await admin.put('/admin/settings/controls.allowSelfApproval', { value: false, version: 1, reason: 'Back to normal' }).expect(200);
    const log = (await admin.get('/admin/audit?entity=Setting&entityId=controls.allowSelfApproval').expect(200)).body;
    expect(log.data.map((l: { reason: string }) => l.reason)).toContain('One-person lab');
  });

  it('bulk approves, reporting each failure without undoing the rest', async () => {
    const a = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    const b = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    const da = await workTest(team, a.sampleTestIds[0], { DENSITY: '0.85' });
    const db = await workTest(team, b.sampleTestIds[0], { DENSITY: '0.85' });
    const res = (await hod.post('/tests/approvals/bulk', { items: [{ id: a.sampleTestIds[0], version: da.version }, { id: b.sampleTestIds[0], version: db.version + 5 }] }).expect(200)).body;
    expect(res.approved).toEqual([a.sampleTestIds[0]]);
    expect(res.failed[0].id).toBe(b.sampleTestIds[0]);
  });

  it('keeps an audit trail of every status change', async () => {
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    await workTest(team, id, { DENSITY: '0.85' });
    const hist = (await tech.get(`/tests/${id}/history`).expect(200)).body;
    expect(hist.map((h: { action: string }) => h.action)).toContain('SampleTest.status');
    expect(hist.map((h: { action: string }) => h.action)).toContain('SampleTest.stage');
  });

  it('renders the test data sheet for the assignee only', async () => {
    const { DocumentsService } = await import('../../src/modules/documents/documents.service.js');
    const { sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    await workTest(team, id, { DENSITY: '0.85' });
    await tech2.post('/documents', { kind: 'test-data', params: { sampleTestId: id } }).expect(403);
    const job = (await tech.post('/documents', { kind: 'test-data', params: { sampleTestId: id } }).expect(201)).body;
    const file = await ctx.app.get(DocumentsService).process(job.id);
    expect(file?.mimeType).toBe('application/pdf');
  }, 60000);
});
