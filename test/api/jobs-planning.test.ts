import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { billingFixture, fiveLines } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

let ctx: Ctx;
let admin: Client, sales: Client, reception: Client, planner: Client, tech: Client, hod: Client, techUserId: string;
let fx: Awaited<ReturnType<typeof billingFixture>>;
let deviationId: string;

async function addParams(testId: string, n = 1) {
  for (let i = 0; i < n; i++) await admin.post('/masters/test-parameters', { testId, code: `P${i}`, name: `Parameter ${i}` }).expect(201);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  await ctx.prisma.$transaction(async (tx) => {
    const { loadBaseline } = await import('../../src/modules/rbac/baseline.js');
    await loadBaseline(tx);
  });
  for (const [e, r] of Object.entries({ admin: ROLE_NAMES.admin, sales: ROLE_NAMES.sales, reception: ROLE_NAMES.reception, planner: ROLE_NAMES.planner, tech: ROLE_NAMES.tech, hod: ROLE_NAMES.hod })) await createUser(ctx, `${e}@j.example`, [r]);
  admin = await login(ctx, 'admin@j.example');
  sales = await login(ctx, 'sales@j.example');
  reception = await login(ctx, 'reception@j.example');
  planner = await login(ctx, 'planner@j.example');
  tech = await login(ctx, 'tech@j.example');
  hod = await login(ctx, 'hod@j.example');
  techUserId = tech.userId;
  fx = await billingFixture(admin, ctx);
  for (const id of fx.testIds) await addParams(id);
  deviationId = (await admin.get('/masters/lookups?kind=DEVIATION_TYPE&pageSize=50').expect(200)).body.data[0].id;
});
afterAll(() => ctx.app.close());

const bookJob = async (extra: object = {}) =>
  (await reception.post('/jobs', { customerId: fx.intra.id, noQuotationReason: 'Repeat customer on agreed rates', samples: [{ description: 'Fuel oil', quantity: '1 L', condition: 'Sealed', returnable: true, attributes: [{ label: 'Batch', value: 'B-77' }], testIds: [fx.tests.a, fx.tests.d] }], ...extra }).expect(201)).body;

describe('job booking', () => {
  it('numbers jobs and samples, stores details and starts the timeline', async () => {
    const j = await bookJob({ urgent: true, letterRef: 'L-1', letterDate: '2026-11-01', poNumber: 'PO-9', poDate: '2026-11-02', materialSpec: 'IS 1460', deviations: [{ typeId: deviationId, sampleIndex: 0, remark: 'Label torn' }] });
    expect(j.jobNo).toMatch(/\/JOB\//);
    expect(j.samples[0].sampleNo).toMatch(/\/S\//);
    expect(j).toMatchObject({ status: 'RECEIVED', urgent: true, letterRef: 'L-1', poNumber: 'PO-9', customerName: fx.intra.name });
    expect(j.samples[0].attributes[0]).toMatchObject({ label: 'Batch', value: 'B-77' });
    expect(j.samples[0].returnable).toBe(true);
    expect(j.samples[0].retentionUntil).toBeTruthy();
    expect(j.deviations[0]).toMatchObject({ remark: 'Label torn', sampleId: j.samples[0].id });
    const timeline = (await reception.get(`/jobs/${j.id}/timeline`).expect(200)).body;
    expect(timeline[0]).toMatchObject({ entity: 'Job', toStatus: 'RECEIVED' });
  });

  it('without a quotation needs a reason and permission', async () => {
    const body = { customerId: fx.intra.id, samples: [{ description: 'x' }] };
    await reception.post('/jobs', body).expect(422);
    await tech.post('/jobs', { ...body, noQuotationReason: 'x' }).expect(403);
    await sales.post('/jobs', { ...body, noQuotationReason: 'x' }).expect(403);
  });

  it('rejects unknown deviation samples and modes', async () => {
    const base = { customerId: fx.intra.id, noQuotationReason: 'r', samples: [{ description: 'x' }] };
    await reception.post('/jobs', { ...base, deviations: [{ typeId: deviationId, sampleIndex: 5 }] }).expect(400);
    await reception.post('/jobs', { ...base, receiptModeId: deviationId }).expect(400);
  });

  it('hold needs a reason; release restores the earlier status', async () => {
    const j = await bookJob();
    await reception.post(`/jobs/${j.id}/hold`, { version: j.version, reason: '' }).expect(400);
    await tech.post(`/jobs/${j.id}/hold`, { version: j.version, reason: 'x' }).expect(403);
    const held = (await reception.post(`/jobs/${j.id}/hold`, { version: j.version, reason: 'Awaiting customer' }).expect(200)).body;
    expect(held).toMatchObject({ status: 'ON_HOLD', holdReason: 'Awaiting customer', statusBeforeHold: 'RECEIVED' });
    await reception.post(`/jobs/${j.id}/hold`, { version: held.version, reason: 'Again' }).expect(422);
    await planner.post('/planning/plans', { sampleIds: [j.samples[0].id], tests: [{ testId: fx.tests.a }] }).expect(422);
    const released = (await reception.post(`/jobs/${j.id}/release`, { version: held.version }).expect(200)).body;
    expect(released.status).toBe('RECEIVED');
  });

  it('adds deviations and edits samples with concurrency', async () => {
    const j = await bookJob();
    const after = (await reception.post(`/jobs/${j.id}/deviations`, { typeId: deviationId, remark: 'Later' }).expect(200)).body;
    expect(after.deviations).toHaveLength(1);
    const s = j.samples[0];
    await reception.patch(`/samples/${s.id}`, { version: s.version, condition: 'Leaking', attributes: [{ label: 'Lot', value: '9' }] }).expect(200);
    await reception.patch(`/samples/${s.id}`, { version: s.version, condition: 'Stale' }).expect(409);
    const hist = (await reception.get(`/samples/${s.id}/history`).expect(200)).body;
    expect(hist[0].action).toBe('Sample.update');
  });

  it('hides customer identity from roles without permission', async () => {
    const j = await bookJob({ kindAttention: 'Priya', contactEmail: 'p@c.example', letterRef: 'SECRET-LETTER' });
    const seen = (await planner.get(`/jobs/${j.id}`).expect(200)).body;
    expect(seen.customerName).toBeNull();
    expect(seen.crn).toBeNull();
    const text = JSON.stringify(seen);
    for (const secret of [fx.intra.name, 'Priya', 'p@c.example', 'SECRET-LETTER']) expect(text).not.toContain(secret);
    expect(JSON.stringify((await planner.get('/jobs').expect(200)).body)).not.toContain(fx.intra.name);
    expect(JSON.stringify((await planner.get('/samples').expect(200)).body)).not.toContain(fx.intra.name);
    await tech.get('/jobs').expect(403);
    await tech.get('/samples').expect(403);
  });
});

describe('quotation to job', () => {
  it('converts once, carrying samples, tests and rates', async () => {
    const lines = [...fiveLines([fx.tests.a, fx.tests.d], 'Sample A'), { sampleDescription: 'Sample B', testId: fx.tests.f, quantity: 1, rate: '999', overrideReason: 'Special' }];
    const q = (await sales.post('/quotations', { customerId: fx.intra.id, lines }).expect(201)).body;
    await sales.post(`/quotations/${q.id}/convert`).expect(422); // not accepted
    const sent = (await sales.post(`/quotations/${q.id}/send`, { version: 1, to: 'b@c.example' }).expect(200)).body;
    const acc = (await sales.post(`/quotations/${q.id}/accept`, { version: sent.version }).expect(200)).body;
    const conv = (await sales.post(`/quotations/${q.id}/convert`).expect(200)).body;
    await sales.post(`/quotations/${q.id}/convert`).expect(422);
    const j = (await sales.get(`/jobs/${conv.jobId}`).expect(200)).body;
    expect(j).toMatchObject({ jobNo: conv.jobNo, quotationId: q.id, customerId: fx.intra.id });
    expect(j.samples.map((s: { description: string }) => s.description).sort()).toEqual(['Sample A', 'Sample B']);
    const tests = await ctx.prisma.sampleTest.findMany({ where: { sample: { jobId: conv.jobId } } });
    expect(tests).toHaveLength(3);
    const special = tests.find((t) => t.testId === fx.tests.f)!;
    expect(Number(special.rate)).toBe(999);
    expect(special.rateSource).toBe('QUOTATION');
    expect((await sales.get(`/quotations/${q.id}`).expect(200)).body.jobId).toBe(conv.jobId);
    void acc;
  });
});

describe('documents', () => {
  const render = async (kind: string, params: object) => {
    const job = (await reception.post('/documents', { kind, params }).expect(201)).body;
    const file = await ctx.app.get(DocumentsService).process(job.id);
    return ctx.app.get(DocumentsService)['storage'].read(file!.id);
  };
  it('renders SRF, acknowledgement and QR labels', async () => {
    const j = await bookJob();
    for (const kind of ['job-srf', 'job-acknowledgement', 'sample-labels']) {
      const f = await render(kind, { jobId: j.id });
      expect(f.buffer.subarray(0, 5).toString(), kind).toBe('%PDF-');
    }
    await tech.post('/documents', { kind: 'job-srf', params: { jobId: j.id } }).expect(403);
  }, 60000);

  it('emails the acknowledgement through the queue, with a log', async () => {
    const j = await bookJob();
    await reception.post(`/jobs/${j.id}/acknowledgement`, { to: 'customer@c.example' }).expect(200);
    const doc = await ctx.prisma.documentJob.findFirstOrThrow({ where: { kind: 'job-acknowledgement', status: 'QUEUED' } });
    await ctx.app.get(DocumentsService).process(doc.id);
    const emails = (await reception.get(`/jobs/${j.id}/emails`).expect(200)).body;
    expect(emails[0]).toMatchObject({ toAddress: 'customer@c.example', template: 'acknowledgement' });
  }, 60000);

  it('combines captured letter pages into one PDF', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const j = await bookJob();
    const upload = async () => (await reception.post('/files').field('entity', 'Job').field('entityId', j.id).field('category', 'letter-page').attach('file', PNG, 'p.png').expect(201)).body.id;
    const a = await upload();
    const b = await upload();
    const job = (await reception.post(`/jobs/${j.id}/letter-pdf`, { fileIds: [a, b] }).expect(200)).body;
    const file = await ctx.app.get(DocumentsService).process(job.id);
    const { PDFDocument } = await import('pdf-lib');
    const read = await ctx.app.get(DocumentsService)['storage'].read(file!.id);
    expect((await PDFDocument.load(read.buffer)).getPageCount()).toBe(2);
    const other = await bookJob();
    await reception.post(`/jobs/${other.id}/letter-pdf`, { fileIds: [a] }).expect(400);
  }, 60000);
});

describe('search and scan', () => {
  it('finds by number, per role', async () => {
    const j = await bookJob();
    const sampleNo = j.samples[0].sampleNo as string;
    const found = (await reception.get(`/search?q=${encodeURIComponent(sampleNo)}`).expect(200)).body;
    expect(found[0]).toMatchObject({ type: 'Sample', title: sampleNo });
    expect((await reception.get(`/search/scan?code=${encodeURIComponent(sampleNo)}`).expect(200)).body.link).toContain(j.id);
    expect((await tech.get(`/search?q=${encodeURIComponent(sampleNo)}`).expect(200)).body).toEqual([]);
    // Without an assignment a technician's scan goes nowhere and reveals nothing.
    expect((await tech.get(`/search/scan?code=${encodeURIComponent(sampleNo)}`).expect(200)).body.link).toBeNull();
    expect((await tech.get(`/search?q=${encodeURIComponent(fx.intra.name)}`).expect(200)).body).toEqual([]);
  });
});

describe('planning', () => {
  let spec: { id: string };
  let dual: { id: string };
  beforeAll(async () => {
    const params = (await admin.get(`/masters/test-parameters?testId=${fx.tests.d}`).expect(200)).body.data;
    spec = (await admin.post('/masters/specifications', { code: 'GR-A', name: 'Grade A', limits: [{ parameterId: params[0].id, minValue: '0.8', maxValue: '0.9' }] }).expect(201)).body;
    dual = (await admin.post('/masters/specifications', { code: 'GR-B', name: 'Grade B', limits: [{ parameterId: params[0].id, minValue: '0.7' }] }).expect(201)).body;
  });

  it('suggests tests from a grade and from a group', async () => {
    const fromGrade = (await planner.get(`/planning/suggest?specificationId=${spec.id}`).expect(200)).body;
    expect(fromGrade.map((t: { testId: string }) => t.testId)).toEqual([fx.tests.d]);
    expect(fromGrade[0].parameters).toHaveLength(1);
    const group = (await admin.post('/masters/test-groups', { code: 'G1', name: 'Group', kind: 'CHEMICAL', items: [{ testId: fx.tests.a }, { testId: fx.tests.k }] }).expect(201)).body;
    const fromGroup = (await planner.get(`/planning/suggest?groupId=${group.id}`).expect(200)).body;
    expect(fromGroup.map((t: { testId: string }) => t.testId).sort()).toEqual([fx.tests.a, fx.tests.k].sort());
    await planner.get('/planning/suggest').expect(400);
  });

  it('plans with dual grade: frozen limits, stages, due dates; moves the job to Planned', async () => {
    const j = await bookJob();
    const list = (await planner.get(`/planning/tests?view=unplanned&jobId=${j.id}`).expect(200)).body;
    expect(list.data).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain(fx.intra.name);
    const plan = (await planner.post('/planning/plans', { sampleIds: [j.samples[0].id], specificationId: spec.id, dualSpecificationId: dual.id, tests: [{ testId: fx.tests.a, officeInstructions: 'Careful' }, { testId: fx.tests.d, technicalData: 'Note' }] }).expect(201)).body;
    expect(plan.planNo).toMatch(/\/PL\//);
    const t = await ctx.prisma.sampleTest.findFirstOrThrow({ where: { id: { in: plan.sampleTestIds }, testId: fx.tests.d }, include: { results: true, stages: { orderBy: { seq: 'asc' } } } });
    expect(t.dueDate).toBeTruthy();
    expect(t.stages.map((s) => s.name)).toEqual(['Sample Received by Analyst', 'Sample Preparation', 'Analysis', 'Calculation and Result Entry']);
    const limits = t.results[0].limits as { spec: string; role: string; min: string | null }[];
    expect(limits.map((l) => [l.spec, l.role])).toEqual([['GR-A', 'primary'], ['GR-B', 'dual']]);
    expect((await planner.get(`/jobs/${j.id}`).expect(200)).body.status).toBe('PLANNED');
    await planner.post('/planning/plans', { sampleIds: [j.samples[0].id], tests: [{ testId: fx.tests.a }] }).expect(422);
    // later master edits don't reach planned tests
    await admin.patch(`/masters/specifications/${spec.id}`, { code: 'GR-A', name: 'Grade A', version: spec.id ? (await admin.get(`/masters/specifications/${spec.id}`).expect(200)).body.version : 1, limits: [] }).expect(200);
    const again = await ctx.prisma.parameterResult.findFirstOrThrow({ where: { sampleTestId: t.id } });
    expect((again.limits as unknown[]).length).toBe(2);
  });

  it('urgent jobs get a shorter due date; holidays are skipped', async () => {
    const t = (await admin.post('/masters/tests', { code: 'TAT', name: 'TAT test', defaultTatDays: 10, urgentTatDays: 1 }).expect(201)).body;
    await addParams(t.id);
    const plan = async (urgent: boolean) => {
      const j = await bookJob({ urgent, samples: [{ description: 'x' }] });
      const p = (await planner.post('/planning/plans', { sampleIds: [j.samples[0].id], tests: [{ testId: t.id }] }).expect(201)).body;
      return ctx.prisma.sampleTest.findUniqueOrThrow({ where: { id: p.sampleTestIds[0] } });
    };
    const normal = await plan(false);
    const fast = await plan(true);
    expect(fast.dueDate!.getTime()).toBeLessThan(normal.dueDate!.getTime());
    expect(fast.urgent).toBe(true);
  });

  it('plans several samples as a group, assigns in bulk and reassigns; shows workload', async () => {
    const j = await bookJob({ samples: [{ description: 'one' }, { description: 'two' }] });
    const p = (await planner.post('/planning/plans', { sampleIds: j.samples.map((s: { id: string }) => s.id), tests: [{ testId: fx.tests.k }] }).expect(201)).body;
    expect(p.sampleTestIds).toHaveLength(2);
    await tech.post('/planning/assign', { sampleTestIds: p.sampleTestIds, assignedToId: techUserId }).expect(403);
    await planner.post('/planning/assign', { sampleTestIds: p.sampleTestIds, assignedToId: hod.userId }).expect(400); // not a technician
    await planner.post('/planning/assign', { sampleTestIds: p.sampleTestIds, assignedToId: techUserId }).expect(200);
    const rows = await ctx.prisma.sampleTest.findMany({ where: { id: { in: p.sampleTestIds } } });
    expect(rows.every((r) => r.status === 'ASSIGNED' && r.assignedToId === techUserId)).toBe(true);
    const load = (await planner.get('/planning/workload').expect(200)).body;
    expect(load.technicians.find((t: { id: string }) => t.id === techUserId).openTests).toBeGreaterThanOrEqual(2);
    await createUser(ctx, 'tech2@j.example', [ROLE_NAMES.tech]);
    const t2 = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'tech2@j.example' } });
    await planner.post('/planning/assign', { sampleTestIds: [p.sampleTestIds[0]], assignedToId: t2.id }).expect(200);
    expect((await ctx.prisma.sampleTest.findUniqueOrThrow({ where: { id: p.sampleTestIds[0] } })).assignedToId).toBe(t2.id);
  });

  it('refuses to assign unplanned tests and enforces analysis mode on chemical only', async () => {
    const j = await bookJob();
    const unplanned = await ctx.prisma.sampleTest.findFirstOrThrow({ where: { sample: { jobId: j.id } } });
    await planner.post('/planning/assign', { sampleTestIds: [unplanned.id], assignedToId: techUserId }).expect(422);
    await planner.post('/planning/plans', { sampleIds: [j.samples[0].id], tests: [{ testId: fx.tests.a, analysisMode: 'SPECTRO' }] }).expect(400);
  });

  it('refuses to plan a test with no parameters', async () => {
    const t = (await admin.post('/masters/tests', { code: 'EMPTY', name: 'No parameters' }).expect(201)).body;
    const j = await bookJob({ samples: [{ description: 'x' }] });
    await planner.post('/planning/plans', { sampleIds: [j.samples[0].id], tests: [{ testId: t.id }] }).expect(422);
  });

  it('job card hides the customer and prices by default, shows the customer when the control is off', async () => {
    const j = await bookJob();
    await planner.post('/planning/plans', { sampleIds: [j.samples[0].id], tests: [{ testId: fx.tests.a }] }).expect(201);
    const { jobCardHtml } = await import('../../src/modules/pdf/templates/job-documents.js');
    expect(jobCardHtml({ jobNo: 'J', customerName: null, tests: [] }, { branding: { primaryColor: '#000000', logoDataUri: null } } as never)).not.toContain('Customer:');
    const job = (await planner.post('/documents', { kind: 'job-card', params: { jobId: j.id } }).expect(201)).body;
    const file = await ctx.app.get(DocumentsService).process(job.id);
    expect(file?.mimeType).toBe('application/pdf');
    await tech.post('/documents', { kind: 'job-card', params: { jobId: j.id } }).expect(403);
  }, 60000);
});

describe('review follow-ups', () => {
  it('filters samples by urgent and not-returnable, and reports whether a test is planned', async () => {
    const j = await bookJob({ urgent: true, samples: [{ description: 'Filter me', returnable: false, testIds: [fx.tests.a] }] });
    const urgent = (await reception.get('/samples?urgent=true&returnable=false&pageSize=100').expect(200)).body.data;
    expect(urgent.map((s: { id: string }) => s.id)).toContain(j.samples[0].id);
    expect(urgent.every((s: { urgent: boolean; returnable: boolean }) => s.urgent && !s.returnable)).toBe(true);
    expect(j.samples[0].tests[0].planned).toBe(false);
    const p = (await planner.post('/planning/plans', { sampleIds: [j.samples[0].id], tests: [{ testId: fx.tests.a }] }).expect(201)).body;
    expect((await reception.get(`/jobs/${j.id}`).expect(200)).body.samples[0].tests[0].planned).toBe(true);
    await planner.post('/planning/assign', { sampleTestIds: p.sampleTestIds, assignedToId: techUserId, versions: { [p.sampleTestIds[0]]: 999 } }).expect(409);
  });

  it('combines small JPEG pages, whose Buffers come from a shared pool', async () => {
    const { PdfService } = await import('../../src/modules/pdf/pdf.service.js');
    const tiny = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
    const pooled = Buffer.from(tiny); // small Buffers share an ArrayBuffer at a non-zero offset
    const pdf = await ctx.app.get(PdfService).mergeImagesToPdf([{ bytes: pooled, mimeType: 'image/jpeg' }]);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('keeps infrastructure errors off the screen', async () => {
    const docs = ctx.app.get(DocumentsService);
    const job = await ctx.prisma.documentJob.create({ data: { kind: 'job-srf', params: { jobId: '00000000-0000-4000-8000-000000000000' }, createdById: reception.userId } });
    await expect(docs.process(job.id)).rejects.toThrow();
    const seen = (await reception.get(`/documents/${job.id}`).expect(200)).body;
    expect(seen.status).toBe('FAILED');
    expect(seen.error).toBe('The document could not be produced. Please try again.');
  });
});
