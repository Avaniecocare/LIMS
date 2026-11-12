import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/core/storage.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, PASSWORD, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { plannedTests, workTest, type Team } from '../support/workflow.js';

/**
 * Instrument graphs and photos on test reports: result images print as numbered, labelled figures; instrument
 * software PDFs print as annexure pages of the same report (same number, one page count, End of Report last);
 * raw data and worksheets are kept with the test and never printed. Everything is frozen when the report is signed.
 */
let ctx: Ctx;
let admin: Client, planner: Client, tech: Client, hod: Client, reviewer: Client, signatory: Client;
let team: Team;
let fx: Awaited<ReturnType<typeof billingFixture>>;
let instrumentId: string;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
/** A small PDF like an instrument's export: `pages` pages, the first one landscape. */
async function instrumentPdf(pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(i === 0 ? [842, 595] : [595, 842]);
    page.drawText(`Load vs extension, page ${i + 1}`, { x: 40, y: 400, size: 18, font });
  }
  return Buffer.from(await doc.save());
}
const upload = (id: string, category: string, file: Buffer, name: string, extra: Record<string, string> = {}) => {
  let t = tech.post('/files').field('entity', 'SampleTest').field('entityId', id).field('category', category);
  for (const [k, v] of Object.entries(extra)) t = t.field(k, v);
  return t.attach('file', file, name);
};
const rev = (r: { revisions: { version: number; id: string }[] }) => r.revisions[0];

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  for (const [e, r] of Object.entries({
    admin: ROLE_NAMES.admin,
    reception: ROLE_NAMES.reception,
    planner: ROLE_NAMES.planner,
    tech: ROLE_NAMES.tech,
    hod: ROLE_NAMES.hod,
    reviewer: ROLE_NAMES.reviewer,
    signatory: ROLE_NAMES.signatory,
  }))
    await createUser(ctx, `${e}@att.example`, [r], `${e} person`);
  admin = await login(ctx, 'admin@att.example');
  planner = await login(ctx, 'planner@att.example');
  tech = await login(ctx, 'tech@att.example');
  hod = await login(ctx, 'hod@att.example');
  reviewer = await login(ctx, 'reviewer@att.example');
  signatory = await login(ctx, 'signatory@att.example');
  team = { reception: await login(ctx, 'reception@att.example'), planner, tech, hod };
  fx = await billingFixture(admin, ctx);
  await admin.post('/masters/test-parameters', { testId: fx.tests.d, code: 'DENSITY', name: 'Density', decimals: 3 }).expect(201);
  instrumentId = (await admin.post('/masters/instruments', { code: 'UTM-01', name: 'Universal testing machine' }).expect(201)).body.id;
});
afterAll(() => ctx.app.close());

/** A test that is started (files can be attached), on its own sample. */
async function startedTest() {
  const { job, sampleTestIds } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
  const id = sampleTestIds[0];
  const d = (await tech.get(`/tests/${id}`).expect(200)).body;
  await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200);
  await ctx.prisma.sampleTest.update({ where: { id }, data: { instrumentId } });
  return { job, id };
}

async function approveAndSign(job: { id: string }, id: string) {
  const d = await workTest(team, id, { DENSITY: '0.850' });
  await hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
  const row = (await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data[0];
  let r = (await reviewer.get(`/reports/${row.id}`).expect(200)).body;
  const preview = (await reviewer.get(`/reports/${row.id}/preview`).expect(200)).body.html as string;
  r = (await reviewer.post(`/reports/${row.id}/submit`, { version: rev(r).version }).expect(200)).body;
  r = (await reviewer.post(`/reports/${row.id}/pass-review`, { version: rev(r).version }).expect(200)).body;
  await signatory.post(`/reports/${row.id}/approve`, { version: rev(r).version, password: PASSWORD }).expect(200);
  const docs = ctx.app.get(DocumentsService);
  for (const p of await ctx.prisma.documentJob.findMany({ where: { kind: 'report-pdf', status: 'QUEUED' } })) await docs.process(p.id);
  const saved = await ctx.prisma.reportRevision.findFirstOrThrow({ where: { reportId: row.id } });
  return { reportId: row.id as string, preview, saved };
}

describe('test files', () => {
  it('keeps each kind of file to what it is for', async () => {
    const { id } = await startedTest();
    const pdf = await instrumentPdf(2);
    // Result images are pictures; instrument reports are PDFs; raw data can be any instrument file.
    expect((await upload(id, 'result-image', pdf, 'curve.pdf').expect(400)).body.error.message).toMatch(/Instrument reports/);
    expect((await upload(id, 'instrument-report', PNG, 'curve.png').expect(400)).body.error.message).toMatch(/PDF files exported/);
    const raw = (await upload(id, 'raw-data', Buffer.from('\x00\x01UTM binary\x02'), 'Test 0012.rst').expect(201)).body;
    expect(raw).toMatchObject({ category: 'raw-data', mimeType: 'application/octet-stream', printOnReport: false });
    expect(raw.sha256).toBe(createHash('sha256').update(Buffer.from('\x00\x01UTM binary\x02')).digest('hex'));
    // A raw file always downloads; it is never opened in the browser.
    expect(decodeURIComponent((await tech.get(`/files/${raw.id}/url`).expect(200)).body.url)).toContain('attachment; filename="Test 0012.rst"');
    const report = (await upload(id, 'instrument-report', pdf, 'Tensile UTM-01.pdf').expect(201)).body;
    expect(report).toMatchObject({ pageCount: 2, printOnReport: true });
    await upload(id, 'unknown-kind', PNG, 'x.png').expect(400);
  });

  it('refuses password-protected, unreadable and over-long instrument PDFs', async () => {
    const { id } = await startedTest();
    // A PDF header and nothing usable after it.
    const broken = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('garbage')]);
    expect((await upload(id, 'instrument-report', broken, 'bad.pdf').expect(400)).body.error.message).toMatch(/could not be read|password/);
    expect((await upload(id, 'instrument-report', await instrumentPdf(21), 'long.pdf').expect(400)).body.error.message).toMatch(/up to 20 pages/);
  });

  it('follows the test master default, and lets the analyst change caption and printing while the test is open', async () => {
    const { id } = await startedTest();
    const master = (await admin.get(`/masters/tests/${fx.tests.d}`).expect(200)).body;
    expect(master.printAttachments).toBe(true);
    await admin.patch(`/masters/tests/${fx.tests.d}`, { ...pick(master), printAttachments: false, version: master.version }).expect(200);
    const img = (await upload(id, 'result-image', PNG, 'fracture.png').expect(201)).body;
    expect(img.printOnReport).toBe(false);
    const changed = (await tech.patch(`/files/${img.id}`, { printOnReport: true, caption: '  Fracture surface  ' }).expect(200)).body;
    expect(changed).toMatchObject({ printOnReport: true, caption: 'Fracture surface' });
    const raw = (await upload(id, 'raw-data', Buffer.from('a,b\n1,2\n'), 'curve.csv').expect(201)).body;
    await tech.patch(`/files/${raw.id}`, { printOnReport: true }).expect(400);
    const fresh = (await admin.get(`/masters/tests/${fx.tests.d}`).expect(200)).body;
    await admin.patch(`/masters/tests/${fx.tests.d}`, { ...pick(fresh), printAttachments: true, version: fresh.version }).expect(200);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'file.update', entityId: id } })).toBe(1);
  });
});

describe('the signed report', () => {
  it('prints labelled figures and appends instrument reports as annexure pages covered by the report fingerprint', async () => {
    const { job, id } = await startedTest();
    await upload(id, 'result-image', PNG, 'specimen.png', { caption: 'Specimen after test' }).expect(201);
    await upload(id, 'result-image', PNG, 'not printed.png', { printOnReport: 'false' }).expect(201);
    const pdfA = await instrumentPdf(2);
    const annex = (await upload(id, 'instrument-report', pdfA, 'Tensile UTM-01.pdf', { caption: 'Load vs extension curve' }).expect(201)).body;
    await upload(id, 'raw-data', Buffer.from('time,load\n0,0\n1,12.5\n'), 'raw.csv').expect(201);
    await upload(id, 'worksheet', PNG, 'worksheet.png').expect(201);

    const { preview, saved } = await approveAndSign(job, id);
    // The body says what follows and how long the whole report is.
    expect(preview).toContain('Figure 1');
    expect(preview).toContain('Specimen after test');
    expect(preview).toContain('UTM-01 Universal testing machine');
    expect(preview).not.toContain('not printed');
    expect(preview).toContain('<h2>Annexures</h2>');
    expect(preview).toContain('Load vs extension curve');
    expect(preview).toContain('Annexure A follows');
    expect(preview).not.toContain('End of Report');

    // Frozen at signing with each annexure's fingerprint.
    const content = saved.content as { tests: { annexes: { fileId: string; sha256: string; pages: number }[]; images: unknown[] }[] };
    expect(content.tests[0].annexes).toEqual([expect.objectContaining({ fileId: annex.id, sha256: annex.sha256, pages: 2 })]);
    expect(content.tests[0].images).toHaveLength(1);

    // The official PDF: the body, then the two annexure pages (the landscape one stays landscape).
    const file = await ctx.app.get(StorageService).read(saved.pdfFileId!);
    const doc = await PDFDocument.load(Uint8Array.from(file.buffer));
    const body = (await PDFDocument.load(Uint8Array.from(file.buffer))).getPageCount() - 2;
    expect(body).toBeGreaterThanOrEqual(1);
    const pages = doc.getPages();
    expect(pages[pages.length - 2].getWidth()).toBeGreaterThan(pages[pages.length - 2].getHeight());
    expect(pages[pages.length - 1].getWidth()).toBeLessThan(pages[pages.length - 1].getHeight());
    // The stored fingerprint is of this whole file, annexures included, so verification covers them.
    expect(saved.pdfSha256).toBe(createHash('sha256').update(file.buffer).digest('hex'));
  }, 90000);

  it('a report without annexures still ends with End of Report and the usual page count', async () => {
    const { job, id } = await startedTest();
    const { preview, saved } = await approveAndSign(job, id);
    expect(preview).toContain('End of Report');
    expect(preview).not.toContain('Annexures');
    expect(saved.pdfSha256).toBeTruthy();
  }, 90000);

  it('locks the test files once results are approved', async () => {
    const { job, id } = await startedTest();
    const img = (await upload(id, 'result-image', PNG, 'locked.png').expect(201)).body;
    const d = await workTest(team, id, { DENSITY: '0.850' });
    await hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
    await upload(id, 'instrument-report', await instrumentPdf(1), 'late.pdf').expect(403);
    await tech.patch(`/files/${img.id}`, { printOnReport: false }).expect(403);
    await tech.del(`/files/${img.id}`).expect(403);
    void job;
  }, 60000);
});

function pick(m: Record<string, unknown>) {
  const { code, name, category, departmentId, methodId, defaultTatDays, urgentTatDays, accredited, accreditedUntil, stages } = m as Record<string, unknown>;
  return { code, name, category, departmentId, methodId, defaultTatDays, urgentTatDays, accredited, accreditedUntil, stages };
}
