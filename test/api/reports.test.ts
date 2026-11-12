import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../../src/core/mail.service.js';
import { StorageService } from '../../src/core/storage.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { ReportsService } from '../../src/modules/reports/reports.service.js';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, PASSWORD, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { plannedTests, workTest, type Team } from '../support/workflow.js';

let ctx: Ctx;
let admin: Client, reception: Client, planner: Client, tech: Client, hod: Client, reviewer: Client, signatory: Client, sales: Client;
let team: Team;
let fx: Awaited<ReturnType<typeof billingFixture>>;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  for (const [e, r] of Object.entries({ admin: ROLE_NAMES.admin, reception: ROLE_NAMES.reception, planner: ROLE_NAMES.planner, tech: ROLE_NAMES.tech, hod: ROLE_NAMES.hod, reviewer: ROLE_NAMES.reviewer, signatory: ROLE_NAMES.signatory, sales: ROLE_NAMES.sales })) await createUser(ctx, `${e}@r.example`, [r], `${e} person`);
  admin = await login(ctx, 'admin@r.example');
  reception = await login(ctx, 'reception@r.example');
  planner = await login(ctx, 'planner@r.example');
  tech = await login(ctx, 'tech@r.example');
  hod = await login(ctx, 'hod@r.example');
  reviewer = await login(ctx, 'reviewer@r.example');
  signatory = await login(ctx, 'signatory@r.example');
  sales = await login(ctx, 'sales@r.example');
  team = { reception, planner, tech, hod };
  fx = await billingFixture(admin, ctx);
  await admin.post('/masters/test-parameters', { testId: fx.tests.d, code: 'DENSITY', name: 'Density', decimals: 3, accredited: true }).expect(201);
  await admin.post('/masters/test-parameters', { testId: fx.tests.a, code: 'APPEAR', name: 'Appearance', kind: 'TEXT' }).expect(201);
  await admin.post('/admin/terms', { kind: 'REPORT', body: 'Original report terms' }).expect(201);
});
afterAll(() => ctx.app.close());

/** Runs a sample's tests through to HoD approval; returns the auto-created report. */
async function approvedReport(testIds = [fx.tests.d]) {
  const { job, sampleTestIds } = await plannedTests(ctx, team, fx.intra.id, testIds);
  for (const id of sampleTestIds) {
    const d = await workTest(team, id, { DENSITY: '0.850', APPEAR: 'Clear' });
    await hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
  }
  const rows = (await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data;
  return { job, sampleTestIds, row: rows[0] };
}

const rev = (r: { revisions: { revisionNo: number; version: number; id: string; status: string }[] }) => r.revisions[0];

async function runPdfJobs() {
  const docs = ctx.app.get(DocumentsService);
  const pending = await ctx.prisma.documentJob.findMany({ where: { kind: 'report-pdf', status: 'QUEUED' } });
  for (const p of pending) await docs.process(p.id);
}

async function toIssued(reportId: string) {
  let r = (await reviewer.get(`/reports/${reportId}`).expect(200)).body;
  if (rev(r).status === 'DRAFT') r = (await reviewer.post(`/reports/${reportId}/submit`, { version: rev(r).version }).expect(200)).body;
  r = (await reviewer.post(`/reports/${reportId}/pass-review`, { version: rev(r).version }).expect(200)).body;
  r = (await signatory.post(`/reports/${reportId}/approve`, { version: rev(r).version, password: PASSWORD }).expect(200)).body;
  await runPdfJobs();
  r = (await signatory.get(`/reports/${reportId}`).expect(200)).body;
  return (await signatory.post(`/reports/${reportId}/issue`, { version: rev(r).version }).expect(200)).body;
}

describe('report draft', () => {
  it('is created automatically once all active tests on a sample are approved', async () => {
    const { job, sampleTestIds } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d, fx.tests.a]);
    const a = await workTest(team, sampleTestIds[0], { DENSITY: '0.85' });
    await hod.post(`/tests/${sampleTestIds[0]}/approve`, { version: a.version }).expect(200);
    expect((await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data).toHaveLength(0);
    const b = await workTest(team, sampleTestIds[1], { APPEAR: 'Clear' });
    await hod.post(`/tests/${sampleTestIds[1]}/approve`, { version: b.version }).expect(200);
    const rows = (await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'DRAFT', revisionNo: 0, customerName: fx.intra.name });
    expect(rows[0].reportNo).toMatch(/\/TR\//);
  });

  it('ignores cancelled tests when deciding the sample is ready', async () => {
    const { job, sampleTestIds } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d, fx.tests.a]);
    await ctx.prisma.sampleTest.update({ where: { id: sampleTestIds[1] }, data: { status: 'CANCELLED', cancelReason: 'x' } });
    const a = await workTest(team, sampleTestIds[0], { DENSITY: '0.85' });
    await hod.post(`/tests/${sampleTestIds[0]}/approve`, { version: a.version }).expect(200);
    expect((await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data).toHaveLength(1);
  });

  it('live preview uses the same template and marks it as a draft', async () => {
    const { row } = await approvedReport();
    const { html } = (await reviewer.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).toContain('DRAFT, NOT FOR ISSUE');
    expect(html).toContain('0.850');
    expect(html).toContain('End of Report');
    expect(html).toContain('Sample not drawn by our laboratory');
    expect(html).toContain('Original report terms');
    expect(html).toContain('Test Parameter');
  });
});

describe('report workflow', () => {
  it('Draft -> In Review -> Pending Approval -> Approved -> Issued with enforced roles', async () => {
    const { job, row } = await approvedReport();
    let r = (await reviewer.get(`/reports/${row.id}`).expect(200)).body;
    await signatory.post(`/reports/${row.id}/approve`, { version: rev(r).version, password: PASSWORD }).expect(422); // wrong state
    await tech.post(`/reports/${row.id}/submit`, { version: rev(r).version }).expect(403);
    r = (await reviewer.post(`/reports/${row.id}/submit`, { version: rev(r).version }).expect(200)).body;
    expect(rev(r).status).toBe('IN_REVIEW');
    await signatory.post(`/reports/${row.id}/pass-review`, { version: rev(r).version }).expect(403);
    r = (await reviewer.post(`/reports/${row.id}/pass-review`, { version: rev(r).version }).expect(200)).body;
    expect(rev(r)).toMatchObject({ status: 'PENDING_APPROVAL', reviewedByName: 'reviewer person' });
    await signatory.post(`/reports/${row.id}/approve`, { version: rev(r).version, password: 'wrong' }).expect(403);
    await reviewer.post(`/reports/${row.id}/approve`, { version: rev(r).version, password: PASSWORD }).expect(403);
    r = (await signatory.post(`/reports/${row.id}/approve`, { version: rev(r).version, password: PASSWORD }).expect(200)).body;
    expect(rev(r)).toMatchObject({ status: 'APPROVED', approvedByName: 'signatory person', pdfReady: false });
    expect(r.revisions[0].signature).toMatchObject({ name: 'signatory person' });
    expect(r.revisions[0].signature.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    // Final PDF comes from the worker; issuing must wait for it.
    const early = await signatory.post(`/reports/${row.id}/issue`, { version: rev(r).version }).expect(422);
    expect(early.body.error.code).toBe('PDF_PENDING');
    await runPdfJobs();
    r = (await signatory.get(`/reports/${row.id}`).expect(200)).body;
    expect(rev(r).pdfReady).toBe(true);
    expect(rev(r).pdfSha256).toMatch(/^[a-f0-9]{64}$/);
    r = (await signatory.post(`/reports/${row.id}/issue`, { version: rev(r).version, emailTo: 'customer@c.example' }).expect(200)).body;
    expect(rev(r).status).toBe('ISSUED');
    expect((await reception.get(`/jobs/${job.id}`).expect(200)).body.status).toBe('COMPLETED');
    const timeline = (await reception.get(`/jobs/${job.id}/timeline`).expect(200)).body;
    for (const s of ['DRAFT', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED']) expect(timeline.map((t: { toStatus: string }) => t.toStatus)).toContain(s);
  }, 60000);

  it('separation of duties: reviewer and signatory must differ unless Admin relaxes it', async () => {
    const both = await createUser(ctx, 'both@r.example', [ROLE_NAMES.reviewer, ROLE_NAMES.signatory], 'Both');
    void both;
    const c = await login(ctx, 'both@r.example');
    const { row } = await approvedReport();
    let r = (await c.get(`/reports/${row.id}`).expect(200)).body;
    r = (await c.post(`/reports/${row.id}/submit`, { version: rev(r).version }).expect(200)).body;
    r = (await c.post(`/reports/${row.id}/pass-review`, { version: rev(r).version }).expect(200)).body;
    const res = await c.post(`/reports/${row.id}/approve`, { version: rev(r).version, password: PASSWORD }).expect(403);
    expect(res.body.error.code).toBe('SAME_REVIEWER');
    await admin.put('/admin/settings/controls.allowSameReviewerSignatory', { value: true, version: 0, reason: 'Small lab' }).expect(200);
    await c.post(`/reports/${row.id}/approve`, { version: rev(r).version, password: PASSWORD }).expect(200);
    await admin.put('/admin/settings/controls.allowSameReviewerSignatory', { value: false, version: 1, reason: 'Restored' }).expect(200);
    await runPdfJobs();
  }, 60000);

  it('reviewer rejection to correct: needs a reason, keeps history, then resubmits', async () => {
    const { row } = await approvedReport();
    let r = (await reviewer.get(`/reports/${row.id}`).expect(200)).body;
    r = (await reviewer.post(`/reports/${row.id}/submit`, { version: rev(r).version }).expect(200)).body;
    await reviewer.post(`/reports/${row.id}/reject`, { version: rev(r).version, reason: '', action: 'CORRECT' }).expect(400);
    r = (await reviewer.post(`/reports/${row.id}/reject`, { version: rev(r).version, reason: 'Wrong description', action: 'CORRECT' }).expect(200)).body;
    expect(rev(r).status).toBe('DRAFT');
    expect(r.revisions[0].rejections[0]).toMatchObject({ stage: 'IN_REVIEW', action: 'CORRECT', reason: 'Wrong description', byName: 'reviewer person' });
    r = (await reviewer.patch(`/reports/${row.id}/draft`, { version: rev(r).version, sampleDescription: 'Corrected description', reportRemarks: 'Corrected on request' }).expect(200)).body;
    expect(r.sampleDescription).toBe('Corrected description');
    const { html } = (await reviewer.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).toContain('Corrected description');
    expect(html).toContain('Corrected on request');
    r = (await reviewer.post(`/reports/${row.id}/submit`, { version: rev(r).version }).expect(200)).body;
    expect(r.revisions[0].rejections).toHaveLength(1); // history stays
    await reviewer.patch(`/reports/${row.id}/draft`, { version: rev(r).version, reportRemarks: 'Sneaky' }).expect(422); // not a draft now
  });

  it('sample photographs: chosen on the draft, printed in order, kept through refreshes, and only this sample\'s', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const { job, row } = await approvedReport();
    const other = await approvedReport();
    const sampleId = (await reviewer.get(`/reports/${row.id}`).expect(200)).body.sampleId;
    // One taken at booking, one added by the reviewer on the report, one belonging to a different sample.
    const atBooking = (await reception.post('/files').field('entity', 'Sample').field('entityId', sampleId).field('category', 'sample-image').attach('file', PNG, 'as received.png').expect(201)).body.id;
    const onReport = (await reviewer.post('/files').field('entity', 'Report').field('entityId', row.id).field('category', 'report-photo').attach('file', PNG, 'after test.png').expect(201)).body.id;
    const otherSampleId = (await reviewer.get(`/reports/${other.row.id}`).expect(200)).body.sampleId;
    const otherSample = (await reception.post('/files').field('entity', 'Sample').field('entityId', otherSampleId).field('category', 'sample-image').attach('file', PNG, 'x.png').expect(201)).body.id;
    await tech.post('/files').field('entity', 'Report').field('entityId', row.id).field('category', 'report-photo').attach('file', PNG, 'no.png').expect(403);

    let r = (await reviewer.get(`/reports/${row.id}`).expect(200)).body;
    expect(r.samplePhotos).toEqual([]);
    const bad = await reviewer.patch(`/reports/${row.id}/draft`, { version: rev(r).version, samplePhotos: [{ fileId: otherSample, widthMm: 80, heightMm: 60 }] }).expect(400);
    expect(bad.body.error.message).toContain('this sample');
    await reviewer.patch(`/reports/${row.id}/draft`, { version: rev(r).version, samplePhotos: [{ fileId: atBooking, widthMm: 10, heightMm: 60 }] }).expect(400);
    r = (await reviewer.patch(`/reports/${row.id}/draft`, { version: rev(r).version, samplePhotos: [{ fileId: onReport, caption: 'Fracture face', widthMm: 120, heightMm: 90 }, { fileId: atBooking, caption: ' As received ', widthMm: 80, heightMm: 60 }] }).expect(200)).body;
    expect(r.samplePhotos).toEqual([
      { fileId: onReport, caption: 'Fracture face', widthMm: 120, heightMm: 90 },
      { fileId: atBooking, caption: 'As received', widthMm: 80, heightMm: 60 },
    ]);
    const { html } = (await reviewer.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).toContain('Sample photographs');
    expect(html.indexOf('Photo 1: Fracture face')).toBeLessThan(html.indexOf('Photo 2: As received'));
    expect(html).toContain('data:image/png;base64,');
    // A later correction that does not mention photographs leaves them alone; an empty list removes them.
    r = (await reviewer.patch(`/reports/${row.id}/draft`, { version: rev(r).version, reportRemarks: 'Photos attached' }).expect(200)).body;
    expect(r.samplePhotos).toHaveLength(2);
    r = (await reviewer.patch(`/reports/${row.id}/draft`, { version: rev(r).version, samplePhotos: [] }).expect(200)).body;
    expect(r.samplePhotos).toEqual([]);
    expect(job.id).toBeTruthy();
  });

  it('signatory rejection for re-test reopens named tests, blocks resubmission, refreshes the draft', async () => {
    const { job, row, sampleTestIds: [testId] } = await approvedReport();
    let r = (await reviewer.get(`/reports/${row.id}`).expect(200)).body;
    r = (await reviewer.post(`/reports/${row.id}/submit`, { version: rev(r).version }).expect(200)).body;
    r = (await reviewer.post(`/reports/${row.id}/pass-review`, { version: rev(r).version }).expect(200)).body;
    await signatory.post(`/reports/${row.id}/reject`, { version: rev(r).version, reason: 'Check density', action: 'RETEST' }).expect(400);
    r = (await signatory.post(`/reports/${row.id}/reject`, { version: rev(r).version, reason: 'Check density', action: 'RETEST', sampleTestIds: [testId] }).expect(200)).body;
    expect(rev(r).status).toBe('DRAFT');
    expect(rev(r)).toMatchObject({ reviewedByName: null });
    const t = (await tech.get(`/tests/${testId}`).expect(200)).body;
    expect(t).toMatchObject({ status: 'IN_PROGRESS', rejectionReason: 'Check density' });
    expect((await reception.get(`/jobs/${job.id}`).expect(200)).body.status).toBe('IN_TESTING');
    const blocked = await reviewer.post(`/reports/${row.id}/submit`, { version: rev(r).version }).expect(422);
    expect(blocked.body.error.code).toBe('TESTS_OPEN');
    const d = await workTest(team, testId, { DENSITY: '0.900' });
    await hod.post(`/tests/${testId}/approve`, { version: d.version }).expect(200);
    const { html } = (await reviewer.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).toContain('0.900');
    expect(html).not.toContain('0.850');
    expect((await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data).toHaveLength(1); // same report
    expect((await reception.get(`/jobs/${job.id}`).expect(200)).body.status).toBe('REPORTING');
  });
});

describe('locking and revisions', () => {
  it('approved and issued reports cannot be edited; a revision goes through review again and supersedes', async () => {
    const { row } = await approvedReport();
    let r = await toIssued(row.id);
    const issued = rev(r);
    expect(issued.status).toBe('ISSUED');
    await reviewer.patch(`/reports/${row.id}/draft`, { version: issued.version, reportRemarks: 'Sneaky' }).expect(422);
    await reviewer.post(`/reports/${row.id}/reject`, { version: issued.version, reason: 'x', action: 'CORRECT' }).expect(422);
    await signatory.post(`/reports/${row.id}/revise`, { reason: '' }).expect(400);
    await reviewer.post(`/reports/${row.id}/revise`, { reason: 'x' }).expect(403);
    r = (await signatory.post(`/reports/${row.id}/revise`, { reason: 'Customer name misspelt' }).expect(200)).body;
    expect(r.revisions.map((x: { revisionNo: number; status: string }) => [x.revisionNo, x.status])).toEqual([[1, 'DRAFT'], [0, 'ISSUED']]);
    await signatory.post(`/reports/${row.id}/revise`, { reason: 'twice' }).expect(422); // already has an open revision
    r = await toIssued(row.id);
    expect(r.revisions.map((x: { revisionNo: number; status: string }) => [x.revisionNo, x.status])).toEqual([[1, 'ISSUED'], [0, 'SUPERSEDED']]);
    expect(r.revisions[1].supersededAt).toBeTruthy();
    expect(r.revisions[0].revisionReason).toBe('Customer name misspelt');
    // the earlier version stays downloadable
    const old = (await signatory.get(`/reports/revisions/${r.revisions[1].id}/pdf`).expect(200)).body;
    expect(old.url).toContain('X-Amz-Signature');
    const { html } = (await signatory.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).toContain('Revision 1');
    expect(html).toContain('replaces');
    expect(html).toContain('Customer name misspelt');
  }, 90000);

  it('emails on issue and resends, with a delivery log', async () => {
    const { row } = await approvedReport();
    const r = await toIssued(row.id);
    expect(rev(r).status).toBe('ISSUED');
    await sales.post(`/reports/${row.id}/email`, { to: 'x@y.example' }).expect(403);
    await signatory.post(`/reports/${row.id}/email`, { to: 'customer@c.example', cc: 'qa@c.example' }).expect(200);
    const log = (await signatory.get(`/reports/${row.id}/emails`).expect(200)).body;
    expect(log[0]).toMatchObject({ toAddress: 'customer@c.example', ccAddress: 'qa@c.example', template: 'report' });
    const mail = ctx.app.get(MailService);
    await mail.deliver(log[0].id);
    const sent = mail.adapter.sent.at(-1)!;
    expect(sent.subject).toContain(row.reportNo);
    expect((await signatory.get(`/reports/${row.id}/emails`).expect(200)).body[0].status).toBe('SENT');
  }, 60000);
});

describe('wording and accreditation', () => {
  it('never claims a digital signature; prints only what the company has enabled', async () => {
    const { row } = await approvedReport();
    await toIssued(row.id);
    const { html } = (await signatory.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).not.toMatch(/digitally signed/i);
    expect(html).toContain('Electronically approved by signatory person');
    expect(html).toMatch(/Report hash \(SHA-256\)/);
    // BluePeak has NABL off and no certification text
    expect(html).not.toMatch(/NABL|ISO\/IEC|accredit/i);
    expect(html).not.toContain('ULR:');
  }, 60000);

  it('hides the sampling statement when the lab drew the sample', async () => {
    const job = (await reception.post('/jobs', { customerId: fx.intra.id, noQuotationReason: 'x', sampleDrawnByLab: true, samples: [{ description: 'x' }] }).expect(201)).body;
    const plan = (await planner.post('/planning/plans', { sampleIds: [job.samples[0].id], tests: [{ testId: fx.tests.d }] }).expect(201)).body;
    await planner.post('/planning/assign', { sampleTestIds: plan.sampleTestIds, assignedToId: tech.userId }).expect(200);
    const d = await workTest(team, plan.sampleTestIds[0], { DENSITY: '0.85' });
    await hod.post(`/tests/${plan.sampleTestIds[0]}/approve`, { version: d.version }).expect(200);
    const row = (await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data[0];
    const { html } = (await reviewer.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).not.toContain('Sample not drawn by our laboratory');
  });

  it('prints attached images at their set print size', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const { job, sampleTestIds: [id] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    let d = (await tech.get(`/tests/${id}`).expect(200)).body;
    d = (await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
    await tech.post('/files').field('entity', 'SampleTest').field('entityId', id).field('category', 'result-image').field('printWidthMm', '91').field('printHeightMm', '47').attach('file', PNG, 'm.png').expect(201);
    d = await workTest(team, id, { DENSITY: '0.85' });
    await hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
    const row = (await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data[0];
    const { html } = (await reviewer.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).toContain('width:91mm;height:47mm');
    expect(html).toContain('data:image/png;base64');
  });

  it('withholds release when the customer setting is on', async () => {
    const cust = (await admin.post('/customers', { name: 'Withheld Co', stateName: 'Maharashtra', stateCode: '27', withholdReportUntilPaid: true }).expect(201)).body;
    const { job, sampleTestIds: [id] } = await plannedTests(ctx, team, cust.id, [fx.tests.d]);
    const d = await workTest(team, id, { DENSITY: '0.85' });
    await hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
    const row = (await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data[0];
    let r = (await reviewer.get(`/reports/${row.id}`).expect(200)).body;
    expect(r.withheld).toBe(true);
    r = (await reviewer.post(`/reports/${row.id}/submit`, { version: rev(r).version }).expect(200)).body;
    r = (await reviewer.post(`/reports/${row.id}/pass-review`, { version: rev(r).version }).expect(200)).body;
    r = (await signatory.post(`/reports/${row.id}/approve`, { version: rev(r).version, password: PASSWORD }).expect(200)).body;
    await runPdfJobs();
    r = (await signatory.get(`/reports/${row.id}`).expect(200)).body;
    const res = await signatory.post(`/reports/${row.id}/issue`, { version: rev(r).version }).expect(422);
    expect(res.body.error.code).toBe('WITHHELD');
  }, 60000);
});

describe('public verification', () => {
  const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

  it('drafts carry no code; approval prints a QR that anyone can verify without signing in', async () => {
    const { row } = await approvedReport();
    const draft = (await reviewer.get(`/reports/${row.id}/preview`).expect(200)).body.html;
    expect(draft).toContain('A QR code for online verification is added when the report is approved');
    await toIssued(row.id);
    const saved = await ctx.prisma.reportRevision.findFirstOrThrow({ where: { reportId: row.id, revisionNo: 0 } });
    expect(saved.verificationCode).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const { html } = (await signatory.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).toContain(`/verify/${saved.verificationCode}`);
    expect(html).toContain('Verify this report');
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="" style="width:23mm/);

    const res = await ctx.http().get(`/api/v1/public/reports/verify/${saved.verificationCode}`).expect(200);
    expect(res.body).toMatchObject({ status: 'VALID', reportNo: row.reportNo, revisionNo: 0, approvedByName: 'signatory person', customerName: expect.any(String), sampleNo: expect.any(String) });
    expect(res.body.pdfSha256).toBe(saved.pdfSha256);
    expect(res.body.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.tests[0].parameters[0]).toEqual({ name: 'Density', value: '0.850', unit: null });
    // Allow-list: nothing that identifies how to reach the customer, and no tax or bank details.
    const keys = keysOf(res.body).map((k) => k.toLowerCase());
    for (const banned of ['address', 'email', 'phone', 'gstin', 'pan', 'bank', 'crn', 'kindattention', 'rate', 'amount']) expect(keys).not.toContain(banned);
  }, 60000);

  it('rejects unknown and malformed codes the same way', async () => {
    for (const code of ['AAAAAAAAAAAAAAAAAAAAAAAA', 'short', 'bad*code*with*symbols*xx']) {
      const res = await ctx.http().get(`/api/v1/public/reports/verify/${code}`).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('a revised report gets its own code and the old one reads as replaced', async () => {
    const { row } = await approvedReport();
    await toIssued(row.id);
    await signatory.post(`/reports/${row.id}/revise`, { reason: 'Sample description corrected' }).expect(200);
    await toIssued(row.id);
    const [newer, older] = await ctx.prisma.reportRevision.findMany({ where: { reportId: row.id }, orderBy: { revisionNo: 'desc' } });
    expect(newer.verificationCode).toBeTruthy();
    expect(newer.verificationCode).not.toBe(older.verificationCode);
    const old = (await ctx.http().get(`/api/v1/public/reports/verify/${older.verificationCode}`).expect(200)).body;
    expect(old).toMatchObject({ status: 'SUPERSEDED', revisionNo: 0, replacedByRevisionNo: 1 });
    expect(old.supersededAt).toBeTruthy();
    expect((await ctx.http().get(`/api/v1/public/reports/verify/${newer.verificationCode}`).expect(200)).body).toMatchObject({ status: 'VALID', revisionNo: 1 });
  }, 90000);
});

describe('snapshots across a lab profile change', () => {
  it('an issued report keeps its company details and PDF when the admin changes the lab profile; branding shows the new name', async () => {
    const { row } = await approvedReport();
    await toIssued(row.id);
    const before = (await signatory.get(`/reports/${row.id}`).expect(200)).body;
    const lab = (await admin.get('/admin/lab').expect(200)).body;
    await admin.put('/admin/lab/profile', { version: lab.profileVersion, profile: { ...lab.profile, companyName: 'Greenfield Analytical', legalName: 'Greenfield Analytical Private Limited' } }).expect(200);
    try {
      const { html } = await ctx.app.get(ReportsService).preview(row.id);
      expect(html).toContain('BluePeak Testing Labs Private Limited');
      expect(html).not.toContain('Greenfield');
      const live = await ctx.prisma.reportRevision.findFirstOrThrow({ where: { reportId: row.id } });
      expect(live.pdfSha256).toBe(before.revisions[0].pdfSha256);
      const stored = await ctx.app.get(StorageService).read(live.pdfFileId!);
      expect(stored.buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect((await ctx.http().get('/api/v1/public/branding').expect(200)).body.companyName).toBe('Greenfield Analytical');
    } finally {
      const now = (await admin.get('/admin/lab').expect(200)).body;
      await admin.put('/admin/lab/profile', { version: now.profileVersion, profile: lab.profile }).expect(200);
    }
  }, 60000);
});

describe('signature image', () => {
  it('is uploaded per user and printed on reports they sign', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'signatory@r.example' } });
    const file = (await admin.post('/files').field('entity', 'User').field('entityId', user.id).field('category', 'signature').attach('file', PNG, 'sig.png').expect(201)).body;
    await admin.post(`/admin/users/${admin.userId}/signature`, { version: 1, fileId: file.id }).expect(400);
    await admin.post(`/admin/users/${user.id}/signature`, { version: user.version, fileId: file.id }).expect(200);
    const { row } = await approvedReport();
    await toIssued(row.id);
    const { html } = (await signatory.get(`/reports/${row.id}/preview`).expect(200)).body;
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="" style="height:36px/);
  }, 60000);
});

describe('report list status', () => {
  it('filters on the newest revision, so a report under revision is not listed as issued', async () => {
    const { row } = await approvedReport();
    await toIssued(row.id);
    const ids = async (status: string) => (await reviewer.get(`/reports?status=${status}&pageSize=200`).expect(200)).body.data.map((r: { id: string }) => r.id);
    expect(await ids('ISSUED')).toContain(row.id);
    await signatory.post(`/reports/${row.id}/revise`, { reason: 'Correction' }).expect(200);
    expect(await ids('ISSUED')).not.toContain(row.id);
    expect(await ids('DRAFT')).toContain(row.id);
    await toIssued(row.id);
    expect(await ids('ISSUED')).toContain(row.id);
    expect(await ids('SUPERSEDED')).not.toContain(row.id);
  }, 90000);
});
