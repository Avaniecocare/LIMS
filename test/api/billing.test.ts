import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../../src/core/mail.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { InvoicesService } from '../../src/modules/invoices/invoices.service.js';
import { issue, issuedJob, type FullTeam } from '../support/cycle.js';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

let ctx: Ctx;
let admin: Client, accounts: Client, tech: Client, dispatch: Client, planner: Client, reception: Client, mgmt: Client;
let team: FullTeam;
let fx: Awaited<ReturnType<typeof billingFixture>>;
const PDF = async (kind: string, params: object, c: Client = accounts) => {
  const job = (await c.post('/documents', { kind, params }).expect(201)).body;
  return ctx.app.get(DocumentsService).process(job.id);
};

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  const { loadBaseline } = await import('../../src/modules/rbac/baseline.js');
  await ctx.prisma.$transaction(loadBaseline);
  for (const [e, r] of Object.entries({ admin: ROLE_NAMES.admin, reception: ROLE_NAMES.reception, planner: ROLE_NAMES.planner, tech: ROLE_NAMES.tech, hod: ROLE_NAMES.hod, reviewer: ROLE_NAMES.reviewer, signatory: ROLE_NAMES.signatory, accounts: ROLE_NAMES.accounts, dispatch: ROLE_NAMES.dispatch, mgmt: ROLE_NAMES.management })) await createUser(ctx, `${e}@b.example`, [r], `${e} person`);
  const c = async (n: string) => login(ctx, `${n}@b.example`);
  admin = await c('admin');
  reception = await c('reception');
  planner = await c('planner');
  tech = await c('tech');
  accounts = await c('accounts');
  dispatch = await c('dispatch');
  mgmt = await c('mgmt');
  team = { reception, planner, tech, hod: await c('hod'), reviewer: await c('reviewer'), signatory: await c('signatory') };
  fx = await billingFixture(admin, ctx);
  for (const id of fx.testIds) await admin.post('/masters/test-parameters', { testId: id, code: 'P', name: 'Result', kind: 'TEXT' }).expect(201);
});
afterAll(() => ctx.app.close());

const invoiceFor = async (customerId = fx.intra.id as string, testIds = fx.testIds) => {
  const { job } = await issuedJob(ctx, team, customerId, testIds, { P: 'OK' });
  return { job, invoice: (await accounts.post('/invoices', { customerId, jobIds: [job.id] }).expect(201)).body };
};

describe('invoice creation', () => {
  it('appears in Ready to Invoice once approved, and leaves once billed', async () => {
    const { job, reportId } = await issuedJob(ctx, team, fx.intra.id, [fx.tests.a], { P: 'OK' });
    const ready = (await accounts.get('/invoices/ready?pageSize=100').expect(200)).body;
    const row = ready.data.find((d: { jobId: string }) => d.jobId === job.id);
    expect(row).toMatchObject({ testCount: 1, missingRates: 0, customerName: fx.intra.name });
    expect(Number(row.amount)).toBe(550);
    expect(row.reportNos).toHaveLength(1);
    await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [job.id] }).expect(201);
    expect((await accounts.get('/invoices/ready?pageSize=100').expect(200)).body.data.find((d: { jobId: string }) => d.jobId === job.id)).toBeUndefined();
    await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [job.id] }).expect(422); // nothing left
    void reportId;
  }, 60000);

  it('intra-state invoice reproduces the required worked example, then issues immutably', async () => {
    const { invoice } = await invoiceFor();
    expect(invoice).toMatchObject({ status: 'DRAFT', invoiceNo: null, isInterState: false });
    expect(Number(invoice.subtotal)).toBe(13200);
    expect(Number(invoice.cgst)).toBe(1188);
    expect(Number(invoice.sgst)).toBe(1188);
    expect(Number(invoice.grandTotal)).toBe(15576);
    expect(invoice.amountInWords).toBe('Fifteen Thousand Five Hundred Seventy-Six Only');
    expect(invoice.lines).toHaveLength(5);
    await tech.post(`/invoices/${invoice.id}/issue`, { version: invoice.version }).expect(403);
    const issued = (await accounts.post(`/invoices/${invoice.id}/issue`, { version: invoice.version, invoiceDate: '2026-11-04' }).expect(200)).body;
    expect(issued.status).toBe('ISSUED');
    expect(issued.invoiceNo).toMatch(/\/INV\/26-27\//);
    expect(issued.dueDate.slice(0, 10)).toBe('2026-12-04'); // 30 credit days
    await accounts.patch(`/invoices/${invoice.id}`, { version: issued.version, notes: 'Sneaky' }).expect(422);
    const row = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect((row.companySnapshot as { gstin: string }).gstin).toBe('27AAAAA0000A1Z2');
    expect((row.customerSnapshot as { name: string }).name).toBe(fx.intra.name);
  }, 60000);

  it('inter-state invoice uses IGST', async () => {
    const { invoice } = await invoiceFor(fx.inter.id);
    expect(Number(invoice.igst)).toBe(2376);
    expect(Number(invoice.cgst)).toBe(0);
    expect(Number(invoice.grandTotal)).toBe(15576);
    expect(invoice.isInterState).toBe(true);
    expect(invoice.placeOfSupplyCode).toBe('29');
  }, 60000);

  it('combines several jobs for a customer, refuses mixing customers', async () => {
    const a = await issuedJob(ctx, team, fx.intra.id, [fx.tests.a], { P: 'OK' });
    const b = await issuedJob(ctx, team, fx.intra.id, [fx.tests.d], { P: 'OK' });
    const other = await issuedJob(ctx, team, fx.inter.id, [fx.tests.a], { P: 'OK' });
    await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [a.job.id, other.job.id] }).expect(400);
    const inv = (await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [a.job.id, b.job.id] }).expect(201)).body;
    expect(inv.lines).toHaveLength(2);
    expect(Number(inv.subtotal)).toBe(1100);
  }, 60000);

  it('rate priority: accepted quotation beats customer rate beats standard rate', async () => {
    const cust = (await admin.post('/customers', { name: 'Priority Co', stateName: 'Maharashtra', stateCode: '27' }).expect(201)).body;
    await admin.post('/masters/customer-rates', { customerId: cust.id, testId: fx.tests.a, rate: '400', effectiveFrom: '2020-01-01' }).expect(201);
    // Customer rate applies with no quotation
    const a = await issuedJob(ctx, team, cust.id, [fx.tests.a], { P: 'OK' });
    const i1 = (await accounts.post('/invoices', { customerId: cust.id, jobIds: [a.job.id] }).expect(201)).body;
    expect(Number(i1.lines[0].rate)).toBe(400);
    expect(i1.lines[0].rateSource).toBe('CUSTOMER_RATE');
    // Standard rate where no customer rate exists
    const b = await issuedJob(ctx, team, cust.id, [fx.tests.d], { P: 'OK' });
    const i2 = (await accounts.post('/invoices', { customerId: cust.id, jobIds: [b.job.id] }).expect(201)).body;
    expect(i2.lines[0].rateSource).toBe('STANDARD_RATE');
    // Quotation wins over both, carried through conversion
    await createUser(ctx, 'sales@b.example', [ROLE_NAMES.sales]);
    const sales = await login(ctx, 'sales@b.example');
    const q = (await sales.post('/quotations', { customerId: cust.id, lines: [{ sampleDescription: 's', testId: fx.tests.a, quantity: 1, rate: '300', overrideReason: 'Deal' }] }).expect(201)).body;
    const sent = (await sales.post(`/quotations/${q.id}/send`, { version: 1, to: 'b@c.example' }).expect(200)).body;
    await sales.post(`/quotations/${q.id}/accept`, { version: sent.version }).expect(200);
    const conv = (await sales.post(`/quotations/${q.id}/convert`).expect(200)).body;
    const job = (await reception.get(`/jobs/${conv.jobId}`).expect(200)).body;
    const plan = (await planner.post('/planning/plans', { sampleIds: [job.samples[0].id], tests: [{ testId: fx.tests.a }] }).expect(201)).body;
    const t = await ctx.prisma.sampleTest.findUniqueOrThrow({ where: { id: plan.sampleTestIds[0] } });
    expect(Number(t.rate)).toBe(300);
    expect(t.rateSource).toBe('QUOTATION');
  }, 120000);

  it('rate overrides on a draft need a reason and are audited', async () => {
    const { job } = await issuedJob(ctx, team, fx.intra.id, [fx.tests.a], { P: 'OK' });
    const inv = (await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [job.id] }).expect(201)).body;
    await accounts.patch(`/invoices/${inv.id}`, { version: inv.version, lineRates: [{ lineId: inv.lines[0].id, rate: '100', reason: '' }] }).expect(400);
    const up = (await accounts.patch(`/invoices/${inv.id}`, { version: inv.version, lineRates: [{ lineId: inv.lines[0].id, rate: '100', reason: 'Goodwill' }] }).expect(200)).body;
    expect(Number(up.lines[0].amount)).toBe(100);
    expect(up.lines[0].rateSource).toBe('OVERRIDE');
    expect(Number(up.grandTotal)).toBe(118);
    const hist = (await accounts.get(`/invoices/${inv.id}/history`).expect(200)).body;
    expect(hist.find((h: { action: string }) => h.action === 'Invoice.rateOverride').reason).toBe('Goodwill');
  }, 60000);

  it('financial data is limited to permitted roles', async () => {
    await tech.get('/invoices').expect(403);
    await tech.get('/invoices/due').expect(403);
    await planner.get('/invoices').expect(403);
    await dispatch.get('/invoices').expect(403);
    await mgmt.get('/invoices').expect(200);
    await mgmt.post('/payments', {}).expect(403);
  });

  it('renders invoice, statement and exports in the background', async () => {
    const { invoice } = await invoiceFor();
    const issued = (await accounts.post(`/invoices/${invoice.id}/issue`, { version: invoice.version }).expect(200)).body;
    expect((await PDF('invoice-pdf', { invoiceId: issued.id }))?.mimeType).toBe('application/pdf');
    expect((await PDF('statement-of-account', { customerId: fx.intra.id }))?.mimeType).toBe('application/pdf');
    expect((await PDF('due-invoices-export', {}))?.mimeType).toContain('spreadsheetml');
    await tech.post('/documents', { kind: 'invoice-pdf', params: { invoiceId: issued.id } }).expect(403);
    await accounts.post(`/invoices/${issued.id}/email`, { to: 'buyer@c.example' }).expect(200);
    const doc = await ctx.prisma.documentJob.findFirstOrThrow({ where: { kind: 'invoice-pdf', status: 'QUEUED' } });
    await ctx.app.get(DocumentsService).process(doc.id);
    const emails = (await accounts.get(`/invoices/${issued.id}/emails`).expect(200)).body;
    await ctx.app.get(MailService).deliver(emails[0].id);
    expect((await accounts.get(`/invoices/${issued.id}/emails`).expect(200)).body[0].status).toBe('SENT');
  }, 90000);
});

describe('payments', () => {
  const issuedInvoice = async (customerId = fx.intra.id as string) => {
    const { invoice } = await invoiceFor(customerId, [fx.tests.f]); // 1100 + 18% = 1298
    return (await accounts.post(`/invoices/${invoice.id}/issue`, { version: invoice.version }).expect(200)).body;
  };

  it('partial then full payment moves status and balance', async () => {
    const inv = await issuedInvoice();
    expect(Number(inv.grandTotal)).toBe(1298);
    await accounts.post('/payments', { customerId: fx.intra.id, paidOn: '2026-11-04', mode: 'NEFT', amount: '500', allocations: [{ invoiceId: inv.id, amount: '500' }] }).expect(201);
    let got = (await accounts.get(`/invoices/${inv.id}`).expect(200)).body;
    expect(got.status).toBe('PARTIALLY_PAID');
    expect(got.balance).toBe('798.00');
    expect((await accounts.get('/invoices/due?pageSize=100').expect(200)).body.data.find((d: { id: string }) => d.id === inv.id).balance).toBe('798.00');
    const over = await accounts.post('/payments', { customerId: fx.intra.id, paidOn: '2026-11-05', mode: 'UPI', amount: '799', allocations: [{ invoiceId: inv.id, amount: '799' }] }).expect(422);
    expect(over.body.error.code).toBe('OVERPAYMENT');
    await accounts.post('/payments', { customerId: fx.intra.id, paidOn: '2026-11-05', mode: 'UPI', reference: 'UTR-1', amount: '798', allocations: [{ invoiceId: inv.id, amount: '798' }] }).expect(201);
    got = (await accounts.get(`/invoices/${inv.id}`).expect(200)).body;
    expect(got.status).toBe('PAID');
    expect(got.balance).toBe('0.00');
    expect(got.allocations).toHaveLength(2);
    expect((await accounts.get('/invoices/due?pageSize=100').expect(200)).body.data.find((d: { id: string }) => d.id === inv.id)).toBeUndefined();
  }, 60000);

  it('never over-allocates under concurrent payments', async () => {
    const inv = await issuedInvoice();
    const pay = () => accounts.post('/payments', { customerId: fx.intra.id, paidOn: '2026-11-05', mode: 'CASH', amount: '700', allocations: [{ invoiceId: inv.id, amount: '700' }] });
    const results = await Promise.all([pay(), pay(), pay()]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await accounts.get(`/invoices/${inv.id}`).expect(200)).body.balance).toBe('598.00');
  }, 60000);

  it('holds an advance and applies it later; reverses a mistaken payment', async () => {
    const adv = (await accounts.post('/payments', { customerId: fx.intra.id, paidOn: '2026-11-01', mode: 'RTGS', amount: '2000' }).expect(201)).body;
    expect(adv).toMatchObject({ isAdvance: true });
    expect(Number(adv.unapplied)).toBe(2000);
    expect((await accounts.get(`/payments?unapplied=true&customerId=${fx.intra.id}`).expect(200)).body.data.map((p: { id: string }) => p.id)).toContain(adv.id);
    const inv = await issuedInvoice();
    await accounts.post(`/payments/${adv.id}/apply`, { allocations: [{ invoiceId: inv.id, amount: '2001' }] }).expect(422);
    const applied = (await accounts.post(`/payments/${adv.id}/apply`, { allocations: [{ invoiceId: inv.id, amount: '1298' }] }).expect(200)).body;
    expect(Number(applied.unapplied)).toBe(702);
    expect((await accounts.get(`/invoices/${inv.id}`).expect(200)).body.status).toBe('PAID');
    await accounts.post(`/payments/${adv.id}/reverse`, { reason: 'Bounced' }).expect(200);
    const back = (await accounts.get(`/invoices/${inv.id}`).expect(200)).body;
    expect(back.status).toBe('ISSUED');
    expect(back.balance).toBe('1298.00');
    expect((await accounts.get(`/payments/${adv.id}`).expect(200)).body.reversed).toBe(true);
    await accounts.post(`/payments/${adv.id}/reverse`, { reason: 'Again' }).expect(404);
  }, 60000);

  it('refuses allocations to another customer or an unissued invoice', async () => {
    const inv = await issuedInvoice();
    await accounts.post('/payments', { customerId: fx.inter.id, paidOn: '2026-11-05', mode: 'CASH', amount: '10', allocations: [{ invoiceId: inv.id, amount: '10' }] }).expect(400);
    await accounts.post('/payments', { customerId: fx.intra.id, paidOn: '2026-11-05', mode: 'CASH', amount: '-10' }).expect(400);
    await accounts.post('/payments', { customerId: fx.intra.id, paidOn: '2026-11-05', mode: 'CASH', amount: '10', allocations: [{ invoiceId: inv.id, amount: '11' }] }).expect(400);
    const { invoice: draft } = await invoiceFor(fx.intra.id, [fx.tests.a]);
    await accounts.post('/payments', { customerId: fx.intra.id, paidOn: '2026-11-05', mode: 'CASH', amount: '10', allocations: [{ invoiceId: draft.id, amount: '10' }] }).expect(422);
  }, 60000);

  it('cancels only without money against it; credit notes reduce the balance and need an issued invoice', async () => {
    const inv = await issuedInvoice();
    await accounts.post(`/invoices/${inv.id}/cancel`, { version: inv.version, reason: '' }).expect(400);
    await accounts.post('/payments', { customerId: fx.intra.id, paidOn: '2026-11-05', mode: 'CASH', amount: '100', allocations: [{ invoiceId: inv.id, amount: '100' }] }).expect(201);
    const paid = (await accounts.get(`/invoices/${inv.id}`).expect(200)).body;
    await accounts.post(`/invoices/${inv.id}/cancel`, { version: paid.version, reason: 'Wrong customer' }).expect(422);
    // Credit 100 taxable + 18 GST = 118
    const cn = (await accounts.post(`/invoices/${inv.id}/credit-notes`, { taxableAmount: '100', reason: 'Test not required' }).expect(200)).body;
    expect(cn.creditNotes[0].creditNoteNo).toMatch(/\/CN\//);
    expect(Number(cn.creditNotes[0].total)).toBe(118);
    expect(Number(cn.creditNotes[0].cgst)).toBe(9);
    expect(cn.balance).toBe('1080.00');
    await accounts.post(`/invoices/${inv.id}/credit-notes`, { taxableAmount: '5000', reason: 'Too much' }).expect(422);
    await tech.post(`/invoices/${inv.id}/credit-notes`, { taxableAmount: '1', reason: 'x' }).expect(403);
    expect((await PDF('credit-note-pdf', { creditNoteId: cn.creditNotes[0].id }))?.mimeType).toBe('application/pdf');

    const { invoice: draft } = await invoiceFor(fx.intra.id, [fx.tests.a]);
    await accounts.post(`/invoices/${draft.id}/credit-notes`, { taxableAmount: '1', reason: 'x' }).expect(422);
    const cancelled = (await accounts.post(`/invoices/${draft.id}/cancel`, { version: draft.version, reason: 'Duplicate' }).expect(200)).body;
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Duplicate' });
    // Cancelled lines free the tests for billing again.
    expect((await accounts.get('/invoices/ready?pageSize=100').expect(200)).body.data.map((d: { jobId: string }) => d.jobId)).toContain(draft.lines[0].jobId);
  }, 90000);
});

describe('due invoices', () => {
  it('calculates overdue from the due date; filters ageing buckets; totals by customer', async () => {
    const cust = (await admin.post('/customers', { name: 'Ageing Co', stateName: 'Maharashtra', stateCode: '27', creditDays: 0, contacts: [{ name: 'Pay', email: 'pay@ageing.example', isPrimary: true }] }).expect(201)).body;
    const make = async (invoiceDate: string) => {
      const { job } = await issuedJob(ctx, team, cust.id, [fx.tests.a], { P: 'OK' });
      const inv = (await accounts.post('/invoices', { customerId: cust.id, jobIds: [job.id] }).expect(201)).body;
      return (await accounts.post(`/invoices/${inv.id}/issue`, { version: inv.version, invoiceDate }).expect(200)).body;
    };
    const old = await make('2020-01-01');
    const fresh = await make('2099-01-01');
    const due = (await accounts.get(`/invoices/due?customerId=${cust.id}`).expect(200)).body;
    const oldRow = due.data.find((d: { id: string }) => d.id === old.id);
    const freshRow = due.data.find((d: { id: string }) => d.id === fresh.id);
    expect(oldRow).toMatchObject({ overdue: true, ageingBucket: '90+' });
    expect(oldRow.daysOverdue).toBeGreaterThan(90);
    expect(freshRow).toMatchObject({ overdue: false, ageingBucket: 'Not Due', daysOverdue: 0 });
    expect((await accounts.get(`/invoices/due?customerId=${cust.id}&bucket=90%2B`).expect(200)).body.data.map((d: { id: string }) => d.id)).toEqual([old.id]);
    expect((await accounts.get(`/invoices/due?customerId=${cust.id}&overdue=false`).expect(200)).body.data.map((d: { id: string }) => d.id)).toEqual([fresh.id]);
    const summary = (await accounts.get(`/invoices/due/summary?customerId=${cust.id}`).expect(200)).body;
    expect(summary.total).toBe('1298.00');
    expect(summary.ageing.find((a: { bucket: string }) => a.bucket === '90+')).toMatchObject({ amount: '649.00', count: 1 });
    expect(summary.customers[0]).toMatchObject({ customerName: 'Ageing Co', outstanding: '1298.00', overdue: '649.00', invoiceCount: 2 });
    // Manual reminder, logged; automatic reminders only on scheduled days when enabled
    await accounts.post(`/invoices/${old.id}/remind`, {}).expect(200);
    const after = (await accounts.get(`/invoices/${old.id}`).expect(200)).body;
    expect(after.reminders[0]).toMatchObject({ kind: 'MANUAL' });
    expect((await accounts.get(`/invoices/${old.id}/emails`).expect(200)).body[0].template).toBe('reminder');
    await tech.post(`/invoices/${old.id}/remind`, {}).expect(403);
    const svc = ctx.app.get(InvoicesService);
    expect(await svc.sendScheduledReminders()).toBe(0); // off by default
    await admin.put('/admin/settings/reminders.enabled', { value: true, version: 0 }).expect(200);
    await admin.put('/admin/settings/reminders.scheduleDays', { value: [5], version: 0 }).expect(200);
    const fiveDaysLate = new Date(fresh.dueDate);
    fiveDaysLate.setUTCDate(fiveDaysLate.getUTCDate() + 5);
    expect(await svc.sendScheduledReminders(fiveDaysLate)).toBe(1);
    expect(await svc.sendScheduledReminders(new Date(fiveDaysLate.getTime() + 86_400_000))).toBe(0);
    expect((await accounts.get(`/invoices/${fresh.id}`).expect(200)).body.reminders[0].kind).toBe('AUTOMATIC');
    await admin.put('/admin/settings/reminders.enabled', { value: false, version: 1 }).expect(200);
  }, 120000);
});

describe('dispatch', () => {
  const lookups = async (kind: string) => (await admin.get(`/masters/lookups?kind=${kind}&pageSize=50`).expect(200)).body.data;

  it('records dispatch of issued reports with mode rules and a challan', async () => {
    const { job, reportId, version } = await issuedJob(ctx, team, fx.intra.id, [fx.tests.a], { P: 'OK' });
    const modes = await lookups('DISPATCH_MODE');
    const courier = modes.find((m: { code: string }) => m.code === 'COURIER').id;
    const hand = modes.find((m: { code: string }) => m.code === 'BY_HAND').id;
    const base = { jobId: job.id, dispatchDate: '2026-11-04', reportIds: [reportId] };
    const notIssued = await dispatch.post('/dispatch', { ...base, modeId: courier, courierName: 'FastShip', docketNo: 'D1' }).expect(422);
    expect(notIssued.body.error.code).toBe('NOT_ISSUED');
    await issue(team, reportId, version);
    const noDocket = await dispatch.post('/dispatch', { ...base, modeId: courier }).expect(400);
    expect(noDocket.body.error.fields.map((f: { field: string }) => f.field).sort()).toEqual(['courierName', 'docketNo']);
    await dispatch.post('/dispatch', { ...base, modeId: hand, carrierName: 'Ravi' }).expect(400);
    await tech.post('/dispatch', { ...base, modeId: courier, courierName: 'x', docketNo: 'y' }).expect(403);
    await dispatch.post('/dispatch', { jobId: job.id, dispatchDate: '2026-11-04', modeId: courier, courierName: 'x', docketNo: 'y' }).expect(400);
    expect((await dispatch.get(`/dispatch/pending?jobId=${job.id}`).expect(200)).body.data[0].reports[0].reportId).toBe(reportId);
    const d = (await dispatch.post('/dispatch', { ...base, modeId: courier, courierName: 'FastShip', docketNo: 'D1', remarks: 'Fragile' }).expect(201)).body;
    expect(d.dispatchNo).toMatch(/\/DC\//);
    expect(d.items[0]).toMatchObject({ kind: 'Report', id: reportId });
    expect((await dispatch.get(`/dispatch/pending?jobId=${job.id}`).expect(200)).body.data).toEqual([]);
    const doc = (await dispatch.post('/documents', { kind: 'dispatch-challan', params: { dispatchId: d.id } }).expect(201)).body;
    expect((await ctx.app.get(DocumentsService).process(doc.id))?.mimeType).toBe('application/pdf');
    const timeline = (await reception.get(`/jobs/${job.id}/timeline`).expect(200)).body;
    expect(timeline.map((t: { toStatus: string }) => t.toStatus)).toContain('DISPATCHED');
  }, 60000);

  it('tracks returnable samples and retention', async () => {
    const job = (await reception.post('/jobs', { customerId: fx.intra.id, noQuotationReason: 'x', samples: [{ description: 'keep', returnable: true }, { description: 'scrap', returnable: false }] }).expect(201)).body;
    const [keep, scrap] = job.samples;
    const pending = (await dispatch.get('/dispatch/returnables?view=pending&pageSize=100').expect(200)).body.data;
    expect(pending.map((p: { id: string }) => p.id)).toContain(keep.id);
    expect(pending.map((p: { id: string }) => p.id)).not.toContain(scrap.id);
    await dispatch.post(`/dispatch/samples/${scrap.id}/return`, { version: scrap.version, returnedAt: '2026-11-04', returnStatus: 'Returned' }).expect(422);
    await dispatch.post(`/dispatch/samples/${keep.id}/return`, { version: keep.version, returnedAt: '2026-11-04', returnStatus: 'Handed to customer' }).expect(200);
    expect((await dispatch.get('/dispatch/returnables?view=returned&pageSize=100').expect(200)).body.data.find((p: { id: string }) => p.id === keep.id)).toMatchObject({ returnStatus: 'Handed to customer' });
    await dispatch.post(`/dispatch/samples/${keep.id}/dispose`, { version: keep.version + 1, disposedAt: '2026-11-05' }).expect(422);
    await ctx.prisma.sample.update({ where: { id: scrap.id }, data: { retentionUntil: new Date('2020-01-01') } });
    const dueForDisposal = (await dispatch.get('/dispatch/returnables?view=due-for-disposal&pageSize=100').expect(200)).body.data;
    expect(dueForDisposal.find((p: { id: string }) => p.id === scrap.id)).toMatchObject({ dueForDisposal: true });
    await dispatch.post(`/dispatch/samples/${scrap.id}/dispose`, { version: scrap.version, disposedAt: '2026-11-05' }).expect(200);
  });
});

describe('cancellation', () => {
  it('shows the impact first, requires permission and reason, drops out of billing, stays visible', async () => {
    const { plannedTests } = await import('../support/workflow.js');
    const { job, sampleTestIds: [a, b] } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.a, fx.tests.d]);
    await tech.post('/cancellations/preview', { type: 'test', id: a }).expect(403);
    await reception.post('/cancellations/preview', { type: 'job', id: job.id }).expect(403);
    const preview = (await planner.post('/cancellations/preview', { type: 'test', id: a }).expect(200)).body;
    expect(preview.canCancel).toBe(true);
    expect(preview.tests[0]).toMatchObject({ id: a, testName: 'Appearance' });
    const t = await ctx.prisma.sampleTest.findUniqueOrThrow({ where: { id: a } });
    await planner.post('/cancellations', { type: 'test', id: a, version: t.version, reason: '' }).expect(400);
    await planner.post('/cancellations', { type: 'test', id: a, version: t.version, reason: 'Not needed' }).expect(200);
    const after = await ctx.prisma.sampleTest.findUniqueOrThrow({ where: { id: a } });
    expect(after).toMatchObject({ status: 'CANCELLED', cancelReason: 'Not needed' });
    const j = (await reception.get(`/jobs/${job.id}`).expect(200)).body;
    expect(j.samples[0].tests.find((x: { id: string }) => x.id === a).status).toBe('CANCELLED'); // visible
    // Cancelling the remaining test's job cascades
    const before = await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    const jp = (await planner.post('/cancellations/preview', { type: 'job', id: job.id }).expect(200)).body;
    expect(jp.tests.map((x: { id: string }) => x.id)).toEqual([b]);
    expect(jp.samples).toHaveLength(1);
    await planner.post('/cancellations', { type: 'job', id: job.id, version: before.version, reason: 'Customer withdrew' }).expect(200);
    const cancelled = (await reception.get(`/jobs/${job.id}`).expect(200)).body;
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Customer withdrew' });
    expect(cancelled.samples[0].status).toBe('CANCELLED');
    await tech.get(`/tests/${b}`).expect(200);
    expect((await tech.get('/tests/my').expect(200)).body.data.map((d: { id: string }) => d.id)).not.toContain(b);
    await planner.post('/cancellations', { type: 'job', id: job.id, version: cancelled.version, reason: 'Again' }).expect(422);
  });

  it('blocks when a report is approved or issued; removes draft invoice lines otherwise', async () => {
    const { job, sampleTestIds: [a] } = await issuedJob(ctx, team, fx.intra.id, [fx.tests.a], { P: 'OK' });
    const preview = (await admin.post('/cancellations/preview', { type: 'job', id: job.id }).expect(200)).body;
    expect(preview.canCancel).toBe(false);
    expect(preview.blockers[0]).toContain('Revise');
    const t = await ctx.prisma.sampleTest.findUniqueOrThrow({ where: { id: a } });
    await admin.post('/cancellations', { type: 'test', id: a, version: t.version, reason: 'x' }).expect(422);

    // A sample whose only approved test sits on a draft invoice, with no approved report.
    const { plannedTests, workTest } = await import('../support/workflow.js');
    const j2 = await plannedTests(ctx, team, fx.intra.id, [fx.tests.a, fx.tests.d]);
    const worked = await workTest(team, j2.sampleTestIds[0], { P: 'OK' });
    await team.hod.post(`/tests/${j2.sampleTestIds[0]}/approve`, { version: worked.version }).expect(200);
    const inv = (await accounts.post('/invoices', { customerId: fx.intra.id, jobIds: [j2.job.id] }).expect(201)).body;
    expect(inv.lines).toHaveLength(1);
    const preview2 = (await admin.post('/cancellations/preview', { type: 'sample', id: j2.job.samples[0].id }).expect(200)).body;
    expect(preview2.draftInvoiceLines).toHaveLength(1);
    const s = await ctx.prisma.sample.findUniqueOrThrow({ where: { id: j2.job.samples[0].id } });
    await admin.post('/cancellations', { type: 'sample', id: s.id, version: s.version, reason: 'Sample lost' }).expect(200);
    const updated = (await accounts.get(`/invoices/${inv.id}`).expect(200)).body;
    expect(updated.lines).toHaveLength(0);
    expect(Number(updated.grandTotal)).toBe(0);
    expect((await accounts.get('/invoices/ready?pageSize=100').expect(200)).body.data.map((d: { jobId: string }) => d.jobId)).not.toContain(j2.job.id);
  }, 90000);
});
