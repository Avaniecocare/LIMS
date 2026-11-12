import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { plannedTests, workTest, type Team } from '../support/workflow.js';

/** "Send photos from my phone": a QR link that lets a phone add photos to one sample or report, briefly. */
let ctx: Ctx;
let admin: Client, reception: Client, planner: Client, tech: Client, hod: Client, reviewer: Client;
let team: Team;
let fx: Awaited<ReturnType<typeof billingFixture>>;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const tokenOf = (url: string) => url.split('/phone/')[1];
// The phone has no session: plain requests without cookies.
const phone = {
  get: (token: string) => ctx.http().get(`/api/v1/public/phone-uploads/${token}`),
  send: (token: string, file = PNG, name = 'IMG_0001.png') => ctx.http().post(`/api/v1/public/phone-uploads/${token}/files`).attach('file', file, name),
};

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
  }))
    await createUser(ctx, `${e}@ph.example`, [r], `${e} person`);
  [admin, reception, planner, tech, hod, reviewer] = await Promise.all(['admin', 'reception', 'planner', 'tech', 'hod', 'reviewer'].map((e) => login(ctx, `${e}@ph.example`)));
  team = { reception, planner, tech, hod };
  fx = await billingFixture(admin, ctx);
  await admin.post('/masters/test-parameters', { testId: fx.tests.d, code: 'DENSITY', name: 'Density', decimals: 3 }).expect(201);
});
afterAll(() => ctx.app.close());

async function sample() {
  const { job } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
  return job.samples[0] as { id: string; sampleNo: string };
}

describe('phone upload links', () => {
  it('reception shows a QR, the phone sends photos without signing in, and they land on the sample', async () => {
    const s = await sample();
    const link = (await reception.post('/phone-uploads', { purpose: 'sample-image', entityId: s.id }).expect(201)).body;
    expect(link.qrDataUri).toMatch(/^data:image\/png;base64,/);
    expect(link.url).toMatch(/\/phone\/[\w-]{43}$/);
    const token = tokenOf(link.url);
    // The phone sees the sample number and the lab, never the customer.
    const seen = (await phone.get(token).expect(200)).body;
    expect(seen).toMatchObject({ label: `Photos of sample ${s.sampleNo}`, remaining: 20 });
    expect(JSON.stringify(seen)).not.toContain(fx.intra.name);
    expect((await phone.send(token).expect(201)).body).toEqual({ received: 1, remaining: 19 });
    await phone.send(token, PNG, 'IMG_0002.png').expect(201);
    const status = (await reception.get(`/phone-uploads/${link.id}`).expect(200)).body;
    expect(status).toMatchObject({ active: true });
    expect(status.fileIds).toHaveLength(2);
    const files = (await reception.get(`/files?entity=Sample&entityId=${s.id}&category=sample-image`).expect(200)).body;
    expect(files.map((f: { id: string }) => f.id)).toEqual(status.fileIds);
    // Recorded as the person who made the link.
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'phoneUpload.received', entityId: s.id } });
    expect(audit?.userName).toBe('reception person');
    // Ending it from the computer stops the phone at once.
    await reception.del(`/phone-uploads/${link.id}`).expect(200);
    expect((await phone.send(token).expect(410)).body.error.code).toBe('LINK_EXPIRED');
    await phone.get(token).expect(410);
  });

  it('only people who may attach photos can make a link, and only its maker can watch or end it', async () => {
    const s = await sample();
    await tech.post('/phone-uploads', { purpose: 'sample-image', entityId: s.id }).expect(403);
    const link = (await reception.post('/phone-uploads', { purpose: 'sample-image', entityId: s.id }).expect(201)).body;
    await planner.get(`/phone-uploads/${link.id}`).expect(404);
    await planner.del(`/phone-uploads/${link.id}`).expect(404);
  });

  it('a report link works only while the report is a draft, for reviewers', async () => {
    const { job, sampleTestIds } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    const d = await workTest(team, sampleTestIds[0], { DENSITY: '0.850' });
    await hod.post(`/tests/${sampleTestIds[0]}/approve`, { version: d.version }).expect(200);
    const report = (await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data[0];
    await reception.post('/phone-uploads', { purpose: 'report-photo', entityId: report.id }).expect(403);
    const link = (await reviewer.post('/phone-uploads', { purpose: 'report-photo', entityId: report.id }).expect(201)).body;
    expect(link.label).toContain(report.reportNo);
    await phone.send(tokenOf(link.url)).expect(201);
    expect((await reviewer.get(`/files?entity=Report&entityId=${report.id}&category=report-photo`).expect(200)).body).toHaveLength(1);
    // Once submitted the draft is closed, and so is the link.
    const r = (await reviewer.get(`/reports/${report.id}`).expect(200)).body;
    await reviewer.post(`/reports/${report.id}/submit`, { version: r.revisions[0].version }).expect(200);
    await phone.send(tokenOf(link.url)).expect(422);
    await reviewer.post('/phone-uploads', { purpose: 'report-photo', entityId: report.id }).expect(422);
  });

  it('refuses guesses, expired links, used-up links, non-photos, and links whose maker has left', async () => {
    await phone.get('not-a-real-token-but-long-enough-to-look-like-one-xx').expect(410);
    await phone.send('x').expect(410);
    const s = await sample();
    const make = async () => (await reception.post('/phone-uploads', { purpose: 'sample-image', entityId: s.id }).expect(201)).body as { id: string; url: string };

    const expired = await make();
    await ctx.prisma.phoneUploadLink.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await phone.send(tokenOf(expired.url)).expect(410);

    const small = await make();
    await ctx.prisma.phoneUploadLink.update({ where: { id: small.id }, data: { maxUploads: 1 } });
    await phone.send(tokenOf(small.url)).expect(201);
    await phone.send(tokenOf(small.url)).expect(410);

    const link = await make();
    await phone.send(tokenOf(link.url), PDF, 'scan.pdf').expect(400);
    expect((await reception.get(`/phone-uploads/${link.id}`).expect(200)).body.fileIds).toEqual([]);

    // The token is never stored, only its hash.
    const row = await ctx.prisma.phoneUploadLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.tokenHash).not.toContain(tokenOf(link.url));

    await ctx.prisma.user.update({ where: { email: 'reception@ph.example' }, data: { isActive: false } });
    await phone.send(tokenOf(link.url)).expect(410);
    await ctx.prisma.user.update({ where: { email: 'reception@ph.example' }, data: { isActive: true } });
  });

  it('a technician sends result photos for their own test in progress, and only then', async () => {
    const { sampleTestIds } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.d]);
    const id = sampleTestIds[0];
    // Assigned but not started: results are not open yet.
    await tech.post('/phone-uploads', { purpose: 'result-image', entityId: id }).expect(403);
    const d = (await tech.get(`/tests/${id}`).expect(200)).body;
    await tech.post(`/tests/${id}/start`, { version: d.version }).expect(200);
    const link = (await tech.post('/phone-uploads', { purpose: 'result-image', entityId: id }).expect(201)).body;
    expect(link.label).toMatch(/^Result photos: .+, sample /);
    await phone.send(tokenOf(link.url)).expect(201);
    expect((await tech.get(`/files?entity=SampleTest&entityId=${id}&category=result-image`).expect(200)).body).toHaveLength(1);
    await reception.post('/phone-uploads', { purpose: 'result-image', entityId: id }).expect(403);
  });

  it('reception photographs the customer letter page by page', async () => {
    const s = await sample();
    const jobId = (await ctx.prisma.sample.findUniqueOrThrow({ where: { id: s.id } })).jobId;
    const link = (await reception.post('/phone-uploads', { purpose: 'letter-page', entityId: jobId }).expect(201)).body;
    expect(link.label).toMatch(/^Pages of the customer's letter, job /);
    await phone.send(tokenOf(link.url), PNG, 'page-1.png').expect(201);
    await phone.send(tokenOf(link.url), PNG, 'page-2.png').expect(201);
    const pages = (await reception.get(`/files?entity=Job&entityId=${jobId}&category=letter-page`).expect(200)).body;
    expect(pages.map((f: { originalName: string }) => f.originalName)).toEqual(['page-1.png', 'page-2.png']);
  });

  it('during booking, phone photos are held for the person booking, then moved onto the new sample', async () => {
    await tech.post('/phone-uploads', { purpose: 'booking' }).expect(403);
    const link = (await reception.post('/phone-uploads', { purpose: 'booking', note: 'sample 2' }).expect(201)).body;
    expect(link.label).toBe('Photos for a new booking (sample 2)');
    await phone.send(tokenOf(link.url), PNG, 'as-received.png').expect(201);
    const [fileId] = (await reception.get(`/phone-uploads/${link.id}`).expect(200)).body.fileIds;
    // The person booking can see it (to show a thumbnail); nobody else can.
    await reception.get(`/files/${fileId}/url`).expect(200);
    await planner.get(`/files/${fileId}/url`).expect(403);
    await admin.get(`/files/${fileId}/url`).expect(403);

    const s = await sample();
    await planner.post('/phone-uploads/claim', { sampleId: s.id, fileIds: [fileId] }).expect(403);
    // Someone else's held photo cannot be claimed either.
    await createUser(ctx, 'reception2@ph.example', [ROLE_NAMES.reception]);
    const other = await login(ctx, 'reception2@ph.example');
    await other.post('/phone-uploads/claim', { sampleId: s.id, fileIds: [fileId] }).expect(403);
    expect((await reception.post('/phone-uploads/claim', { sampleId: s.id, fileIds: [fileId] }).expect(201)).body).toEqual({ claimed: 1 });
    const files = (await reception.get(`/files?entity=Sample&entityId=${s.id}&category=sample-image`).expect(200)).body;
    expect(files.map((f: { id: string }) => f.id)).toContain(fileId);
    // Once moved it follows the sample's rules, and cannot be claimed again.
    await reception.post('/phone-uploads/claim', { sampleId: s.id, fileIds: [fileId] }).expect(403);
  });
});
