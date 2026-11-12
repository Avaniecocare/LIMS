import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../../src/core/mail.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { QuotationsService } from '../../src/modules/quotations/quotations.service.js';
import { billingFixture, fiveLines } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

let ctx: Ctx;
let admin: Client;
let sales: Client;
let tech: Client;
let mgmt: Client;
let fx: Awaited<ReturnType<typeof billingFixture>>;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  await createUser(ctx, 'a@q.example', [ROLE_NAMES.admin]);
  await createUser(ctx, 's@q.example', [ROLE_NAMES.sales]);
  await createUser(ctx, 't@q.example', [ROLE_NAMES.tech]);
  await createUser(ctx, 'm@q.example', [ROLE_NAMES.management]);
  admin = await login(ctx, 'a@q.example');
  sales = await login(ctx, 's@q.example');
  tech = await login(ctx, 't@q.example');
  mgmt = await login(ctx, 'm@q.example');
  fx = await billingFixture(admin, ctx);
});
afterAll(() => ctx.app.close());

const create = async (customerId = fx.intra.id as string, extra: object = {}) => (await sales.post('/quotations', { customerId, lines: fiveLines(fx.testIds), ...extra }).expect(201)).body;

describe('quotation totals', () => {
  it('intra-state matches the required worked example', async () => {
    const q = await create();
    const v = q.versions[0];
    expect(Number(v.subtotal)).toBe(13200);
    expect(Number(v.cgst)).toBe(1188);
    expect(Number(v.sgst)).toBe(1188);
    expect(Number(v.igst)).toBe(0);
    expect(Number(v.grandTotal)).toBe(15576);
    expect(v.amountInWords).toBe('Fifteen Thousand Five Hundred Seventy-Six Only');
    expect(v.lines.map((l: { rateSource: string }) => l.rateSource)).toEqual(Array(5).fill('STANDARD_RATE'));
    expect(q.quotationNo).toMatch(/^BP\/QT\/\d\d-\d\d\/\d{5}$/);
  });

  it('inter-state uses IGST', async () => {
    const q = await create(fx.inter.id);
    expect(Number(q.versions[0].igst)).toBe(2376);
    expect(Number(q.versions[0].cgst)).toBe(0);
    expect(Number(q.versions[0].grandTotal)).toBe(15576);
  });

  it('ignores any totals a client tries to send', async () => {
    await sales.post('/quotations', { customerId: fx.intra.id, lines: fiveLines(fx.testIds), grandTotal: '1' }).expect(400);
  });

  it('applies line and header discounts on the server', async () => {
    const q = await create(fx.intra.id, { discountPct: '10', lines: [{ sampleDescription: 's', testId: fx.tests.f, quantity: 2, discountPct: '50' }] });
    const v = q.versions[0];
    expect(Number(v.lines[0].amount)).toBe(1100);
    expect(Number(v.discountAmount)).toBe(110);
    expect(Number(v.taxableAmount)).toBe(990);
  });
});

describe('rate priority', () => {
  it('customer rate beats standard rate; override needs permission and a reason', async () => {
    const cust = (await admin.post('/customers', { name: 'Rate Customer', stateName: 'Maharashtra', stateCode: '27' }).expect(201)).body;
    await admin.post('/masters/customer-rates', { customerId: cust.id, testId: fx.tests.a, rate: '400', effectiveFrom: '2020-01-01' }).expect(201);
    const line = { sampleDescription: 's', testId: fx.tests.a, quantity: 1 };
    const q = (await sales.post('/quotations', { customerId: cust.id, lines: [line] }).expect(201)).body;
    expect(q.versions[0].lines[0]).toMatchObject({ rateSource: 'CUSTOMER_RATE' });
    expect(Number(q.versions[0].lines[0].rate)).toBe(400);
    await sales.post('/quotations', { customerId: cust.id, lines: [{ ...line, rate: '300' }] }).expect(400);
    const o = (await sales.post('/quotations', { customerId: cust.id, lines: [{ ...line, rate: '300', overrideReason: 'Bulk deal' }] }).expect(201)).body;
    expect(o.versions[0].lines[0]).toMatchObject({ rateSource: 'OVERRIDE', overrideReason: 'Bulk deal' });

    const noOverride = await createUser(ctx, 'limited@q.example', [ROLE_NAMES.sales]);
    const role = await ctx.prisma.role.create({ data: { name: 'Sales without override', permissions: { create: [{ permissionCode: 'quotations.edit' }] } } });
    await ctx.prisma.userRole.deleteMany({ where: { userId: noOverride.id } });
    await ctx.prisma.userRole.create({ data: { userId: noOverride.id, roleId: role.id } });
    const lim = await login(ctx, 'limited@q.example');
    await lim.post('/quotations', { customerId: cust.id, lines: [{ ...line, rate: '300', overrideReason: 'x' }] }).expect(403);
    // Sending the looked-up rate back is not an override.
    await lim.post('/quotations', { customerId: cust.id, lines: [{ ...line, rate: '400.00' }] }).expect(201);
  });

  it('needs a rate from somewhere', async () => {
    const t = (await admin.post('/masters/tests', { code: 'NORATE', name: 'No rate' }).expect(201)).body;
    const res = await sales.post('/quotations', { customerId: fx.intra.id, lines: [{ sampleDescription: 's', testId: t.id, quantity: 1 }] }).expect(400);
    expect(res.body.error.message).toContain('No rate');
  });
});

describe('quotation workflow', () => {
  it('a customer can accept a draft on the phone; what was agreed is frozen as if it had been sent', async () => {
    const q = await create();
    const accepted = (await sales.post(`/quotations/${q.id}/accept`, { version: q.version }).expect(200)).body;
    expect(accepted.status).toBe('ACCEPTED');
    const v = await ctx.prisma.quotationVersion.findFirstOrThrow({ where: { quotationId: q.id } });
    expect(v.companySnapshot).toBeTruthy();
    expect(v.customerSnapshot).toBeTruthy();
  });

  it('Draft -> Sent -> Accepted, with enforced permissions and a frozen version', async () => {
    const q = await create();
    await tech.post(`/quotations/${q.id}/send`, { version: 1, to: 'x@y.example' }).expect(403);
    await tech.post(`/quotations/${q.id}/accept`, { version: 1 }).expect(403);
    const sent = (await sales.post(`/quotations/${q.id}/send`, { version: 1, to: 'buyer@cust.example', message: 'Please review' }).expect(200)).body;
    expect(sent.status).toBe('SENT');
    await sales.patch(`/quotations/${q.id}`, { version: sent.version, customerId: q.customerId, lines: fiveLines(fx.testIds) }).expect(422);
    await sales.post(`/quotations/${q.id}/accept`, { version: 1 }).expect(409); // stale
    const accepted = (await sales.post(`/quotations/${q.id}/accept`, { version: sent.version }).expect(200)).body;
    expect(accepted.status).toBe('ACCEPTED');
    await sales.post(`/quotations/${q.id}/revise`, { version: accepted.version, reason: 'late change' }).expect(422);
    const history = (await sales.get(`/quotations/${q.id}/history`).expect(200)).body;
    expect(history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['ACCEPTED', 'SENT', 'DRAFT']);
  });

  it('rejection needs a reason; revising makes a new version and keeps the old', async () => {
    const q = await create();
    const sent = (await sales.post(`/quotations/${q.id}/send`, { version: 1, to: 'b@c.example' }).expect(200)).body;
    await sales.post(`/quotations/${q.id}/reject`, { version: sent.version, reason: '' }).expect(400);
    const rejected = (await sales.post(`/quotations/${q.id}/reject`, { version: sent.version, reason: 'Too expensive' }).expect(200)).body;
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectReason: 'Too expensive' });
    const revised = (await sales.post(`/quotations/${q.id}/revise`, { version: rejected.version, reason: 'Lower price' }).expect(200)).body;
    expect(revised).toMatchObject({ status: 'DRAFT', currentVersionNo: 2 });
    expect(revised.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
    const edited = (await sales.patch(`/quotations/${q.id}`, { version: revised.version, customerId: q.customerId, lines: [{ sampleDescription: 'x', testId: fx.tests.a, quantity: 1 }] }).expect(200)).body;
    expect(Number(edited.versions[0].subtotal)).toBe(550);
    expect(Number(edited.versions[1].subtotal)).toBe(13200); // version 1 untouched
    expect(edited.versions[1].lines).toHaveLength(5);
  });

  it('expires after the validity date, automatically and on acceptance', async () => {
    const q = await create(fx.intra.id, { validUntil: '2099-01-01' });
    const sent = (await sales.post(`/quotations/${q.id}/send`, { version: 1, to: 'b@c.example' }).expect(200)).body;
    const service = ctx.app.get(QuotationsService);
    expect(await service.expireOverdue(new Date('2099-01-01'))).toBe(0); // still valid on the last day
    const n = await service.expireOverdue(new Date('2099-01-02'));
    expect(n).toBeGreaterThanOrEqual(1);
    const after = (await sales.get(`/quotations/${q.id}`).expect(200)).body;
    expect(after.status).toBe('EXPIRED');
    await sales.post(`/quotations/${q.id}/accept`, { version: sent.version + 1 }).expect(422);
    const past = await create(fx.intra.id, { validUntil: '2020-01-01' });
    await sales.post(`/quotations/${past.id}/send`, { version: 1, to: 'b@c.example' }).expect(422);
  });

  it('management can read but not act', async () => {
    const q = await create();
    await mgmt.get(`/quotations/${q.id}`).expect(200);
    await mgmt.post('/quotations', { customerId: fx.intra.id, lines: fiveLines(fx.testIds) }).expect(403);
    await mgmt.post(`/quotations/${q.id}/send`, { version: 1, to: 'x@y.example' }).expect(403);
  });

  it('tech cannot read quotations or prices', async () => {
    await tech.get('/quotations').expect(403);
  });

  it('filters and pagination', async () => {
    const res = (await sales.get(`/quotations?customerId=${fx.inter.id}&pageSize=1&sort=grandTotal&order=asc`).expect(200)).body;
    expect(res.data).toHaveLength(1);
    expect(res.meta.total).toBeGreaterThanOrEqual(1);
  });
});

describe('quotation email and PDF', () => {
  it('renders in the background, attaches, logs delivery, and freezes company details', async () => {
    const q = await create(fx.intra.id, { documentTitle: 'Proforma Invoice' });
    await sales.post(`/quotations/${q.id}/send`, { version: 1, to: 'buyer@cust.example', cc: 'copy@cust.example' }).expect(200);
    const job = await ctx.prisma.documentJob.findFirstOrThrow({ where: { kind: 'quotation-pdf', status: 'QUEUED' }, orderBy: { createdAt: 'desc' } });
    const file = await ctx.app.get(DocumentsService).process(job.id);
    expect(file?.mimeType).toBe('application/pdf');
    const pdf = await ctx.app.get(DocumentsService)['storage'].read(file!.id);
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const logs = (await sales.get(`/quotations/${q.id}/emails`).expect(200)).body;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ toAddress: 'buyer@cust.example', ccAddress: 'copy@cust.example', status: 'QUEUED' });
    const mail = ctx.app.get(MailService);
    await mail.deliver(logs[0].id);
    const sentNow = (await sales.get(`/quotations/${q.id}/emails`).expect(200)).body[0];
    expect(sentNow.status).toBe('SENT');
    const delivered = mail.adapter.sent.at(-1)!;
    expect(delivered.subject).toContain('Proforma Invoice');
    expect(delivered.subject).toContain('BluePeak Testing Labs');
    expect(delivered.from).toContain('BluePeak Testing Labs');
    expect(delivered.html).toContain('BluePeak Testing Labs Private Limited');

    const version = await ctx.prisma.quotationVersion.findFirstOrThrow({ where: { quotationId: q.id } });
    expect((version.companySnapshot as { legalName: string }).legalName).toBe('BluePeak Testing Labs Private Limited');
    expect((version.customerSnapshot as { name: string }).name).toBe(fx.intra.name);
  }, 60000);

  it('escapes user text in the PDF template', async () => {
    const q = await create(fx.intra.id, { lines: [{ sampleDescription: '<img src=x onerror=alert(1)>', testId: fx.tests.a, quantity: 1 }] });
    const html = await ctx.app.get(QuotationsService).preview(q.versions[0].id);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('orders', () => {
  it('moves through the pipeline as quotations progress', async () => {
    const o = (await sales.post('/orders', { customerId: fx.intra.id, source: 'EMAIL', reference: 'RFQ-1', receivedOn: '2026-11-01' }).expect(201)).body;
    expect(o).toMatchObject({ stage: 'NEW', customerName: fx.intra.name });
    expect(o.orderNo).toMatch(/\/ORD\//);
    const q = await create(fx.intra.id, { orderId: o.id });
    expect((await sales.get(`/orders/${o.id}`).expect(200)).body).toMatchObject({ stage: 'QUOTED', quotationCount: 1 });
    const sent = (await sales.post(`/quotations/${q.id}/send`, { version: 1, to: 'b@c.example' }).expect(200)).body;
    await sales.post(`/quotations/${q.id}/accept`, { version: sent.version }).expect(200);
    expect((await sales.get(`/orders/${o.id}`).expect(200)).body.stage).toBe('WON');
    const pipeline = (await sales.get('/orders/pipeline').expect(200)).body;
    expect(pipeline.find((s: { stage: string }) => s.stage === 'WON').count).toBeGreaterThanOrEqual(1);
    await tech.get('/orders').expect(403);
    await sales.post('/orders', { customerId: fx.intra.id, source: 'PIGEON', receivedOn: '2026-11-01' }).expect(400);
    await sales.patch(`/orders/${o.id}`, { customerId: fx.intra.id, source: 'PHONE', receivedOn: '2026-11-01', version: 99 }).expect(409);
  });
});
