import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { issuedJob, type FullTeam } from '../support/cycle.js';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { gstinCheckChar } from '../../src/common/india.js';

let ctx: Ctx;
let admin: Client, accounts: Client, tech: Client;
let team: FullTeam;
let fx: Awaited<ReturnType<typeof billingFixture>>;
let b2b: { id: string }, b2bOther: { id: string }, noPin: { id: string };
const gstin = (first14: string) => first14 + gstinCheckChar(first14);

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
    await createUser(ctx, `${e}@e.example`, [r], `${e} person`);
  const c = (n: string) => login(ctx, `${n}@e.example`);
  admin = await c('admin');
  accounts = await c('accounts');
  tech = await c('tech');
  team = { reception: await c('reception'), planner: await c('planner'), tech, hod: await c('hod'), reviewer: await c('reviewer'), signatory: await c('signatory') };
  fx = await billingFixture(admin, ctx, 'E');
  for (const id of fx.testIds) await admin.post('/masters/test-parameters', { testId: id, code: 'P', name: 'Result', kind: 'TEXT' }).expect(201);
  const customer = async (name: string, g: string, stateName: string, stateCode: string, city: string, pincode?: string) =>
    (
      await admin
        .post('/customers', {
          name,
          gstin: g,
          stateName,
          stateCode,
          addresses: [{ kind: 'BILLING', line1: '7 Industrial Area', city, stateName, stateCode, ...(pincode ? { pincode } : {}) }],
          contacts: [{ name: 'Ravi', email: 'ravi@buyer.example', isPrimary: true }],
        })
        .expect(201)
    ).body;
  b2b = await customer('Contoso Forgings Ltd', gstin('27CCCCC1234C1Z'), 'Maharashtra', '27', 'Pune', '411026');
  b2bOther = await customer('Fabrikam Castings Pvt Ltd', gstin('29DDDDD5678D1Z'), 'Karnataka', '29', 'Bengaluru', '560058');
  noPin = await customer('Northwind Tools Ltd', gstin('27EEEEE9012E1Z'), 'Maharashtra', '27', 'Nashik');
});
afterAll(() => ctx.app.close());

const issuedInvoice = async (customerId: string, extra: object = {}) => {
  const { job } = await issuedJob(ctx, team, customerId, [fx.tests.f], { P: 'OK' }); // 1100 + 18%
  const draft = (await accounts.post('/invoices', { customerId, jobIds: [job.id] }).expect(201)).body;
  return (await accounts.post(`/invoices/${draft.id}/issue`, { version: draft.version, ...extra }).expect(200)).body;
};
const settingVersion = async (key: string) => ((await admin.get('/admin/settings').expect(200)).body as { key: string; version: number }[]).find((s) => s.key === key)?.version ?? 0;

describe('e-invoicing', () => {
  it('stays off until an administrator turns it on, even with the server set up', async () => {
    const mods = (await admin.get('/admin/lab/modules').expect(200)).body;
    expect(mods.modules.find((m: { key: string }) => m.key === 'einvoice')).toMatchObject({ enabled: false, setupNeeded: null });
    const inv = await issuedInvoice(b2b.id);
    expect(inv).toMatchObject({ einvoiceRequired: false, einvoice: null });
    await accounts.post(`/invoices/${inv.id}/einvoice`).expect(422);
    await admin.put('/admin/lab/modules', { version: mods.version, enabled: { einvoice: true } }).expect(200);
  }, 90000);

  it('lists what is missing before anything can be registered, then is ready', async () => {
    await tech.get('/admin/lab/einvoice').expect(403);
    let s = (await admin.get('/admin/lab/einvoice').expect(200)).body;
    expect(s).toMatchObject({ configured: true, enabled: true, provider: 'mock', environment: 'sandbox', autoOnIssue: true });
    const fields = s.problems.map((p: { field: string }) => p.field);
    expect(fields).toEqual(expect.arrayContaining(['seller.line1', 'seller.city', 'seller.pincode', 'numbering.INVOICE', 'numbering.CREDIT_NOTE']));
    expect(s.problems.find((p: { field: string }) => p.field === 'numbering.INVOICE').message).toMatch(/BP\/INV\/\d\d-\d\d\/99999 \(18 characters\)/);

    s = (
      await admin
        .put('/admin/lab/einvoice', {
          seller: { line1: 'Unit 1, Example Industrial Estate', line2: '', city: 'Pune', pincode: '411001' },
          autoOnIssue: true,
          sellerVersion: s.sellerVersion,
          autoOnIssueVersion: s.autoOnIssueVersion,
        })
        .expect(200)
    ).body;
    await admin
      .put('/admin/lab/einvoice', { seller: { line1: 'x', line2: '', city: 'Pune', pincode: '0110' }, autoOnIssue: true, sellerVersion: s.sellerVersion, autoOnIssueVersion: s.autoOnIssueVersion })
      .expect(400);
    const formats = ((await admin.get('/admin/settings').expect(200)).body as { key: string; value: Record<string, string> }[]).find((x) => x.key === 'numbering.formats')!.value;
    await admin
      .put('/admin/settings/numbering.formats', { value: { ...formats, INVOICE: '{PREFIX}/{FY}/{SEQ:5}', CREDIT_NOTE: '{PREFIX}/CN{FY}/{SEQ:4}' }, version: await settingVersion('numbering.formats') })
      .expect(200);
    expect((await admin.get('/admin/lab/einvoice').expect(200)).body.problems).toEqual([]);
    await admin.post('/admin/lab/einvoice/check').expect(200);
  });

  it('registers a B2B invoice when it is issued, and prints the IRN and QR code on it', async () => {
    const inv = await issuedInvoice(b2b.id);
    expect(inv.invoiceNo).toMatch(/^BP\/\d\d-\d\d\/\d{5}$/);
    expect(inv.einvoiceRequired).toBe(true);
    expect(inv.einvoice).toMatchObject({ status: 'GENERATED', provider: 'mock', test: true, attempts: 1, lastError: null });
    expect(inv.einvoice.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.einvoice.qrDataUri).toMatch(/^data:image\/png;base64,/);
    expect(new Date(inv.einvoice.cancellableUntil).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const row = await ctx.prisma.eInvoice.findUniqueOrThrow({ where: { invoiceId: inv.id } });
    expect(row.payload).toMatchObject({
      DocDtls: { Typ: 'INV', No: inv.invoiceNo },
      SellerDtls: { Gstin: '27AAAAA0000A1Z2', Pin: 411001, Loc: 'Pune' },
      BuyerDtls: { Pos: '27', Pin: 411026 },
      ValDtls: { TotInvVal: 1298, CgstVal: 99, SgstVal: 99 },
    });
    // Issued again (a second click) changes nothing
    expect((await accounts.post(`/invoices/${inv.id}/einvoice`).expect(200)).body.einvoice.irn).toBe(inv.einvoice.irn);

    const job = (await accounts.post('/documents', { kind: 'invoice-pdf', params: { invoiceId: inv.id } }).expect(201)).body;
    const pdf = await ctx.app.get(DocumentsService).process(job.id);
    expect(pdf?.mimeType).toBe('application/pdf');
    const history = (await accounts.get(`/invoices/${inv.id}/history`).expect(200)).body;
    expect(JSON.stringify(history)).toContain('EInvoice.generated');
  }, 90000);

  it('registers an inter-state invoice with IGST', async () => {
    const inv = await issuedInvoice(b2bOther.id);
    expect(inv.einvoice.status).toBe('GENERATED');
    const row = await ctx.prisma.eInvoice.findUniqueOrThrow({ where: { invoiceId: inv.id } });
    expect(row.payload).toMatchObject({ BuyerDtls: { Pos: '29', Stcd: '29' }, ValDtls: { IgstVal: 198, CgstVal: 0, SgstVal: 0 } });
  }, 90000);

  it('leaves B2C invoices alone', async () => {
    const inv = await issuedInvoice(fx.intra.id);
    expect(inv).toMatchObject({ status: 'ISSUED', einvoiceRequired: false, einvoice: null });
    const res = await accounts.post(`/invoices/${inv.id}/einvoice`).expect(422);
    expect(res.body.error.message).toMatch(/without a GSTIN/);
    await accounts.post(`/invoices/${inv.id}/email`, { to: 'a@b.example' }).expect(200);
  }, 90000);

  it('keeps the invoice issued when registration fails, says why, holds the email, and registers on retry', async () => {
    const inv = await issuedInvoice(noPin.id, { emailTo: 'ravi@buyer.example' });
    expect(inv.status).toBe('ISSUED');
    expect(inv.einvoice).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(inv.einvoice.lastError).toMatch(/customer's address needs a 6-digit PIN code/);
    expect(await ctx.prisma.documentJob.count({ where: { kind: 'invoice-pdf', params: { path: ['invoiceId'], equals: inv.id } } })).toBe(0);
    const blocked = await accounts.post(`/invoices/${inv.id}/email`, { to: 'ravi@buyer.example' }).expect(422);
    expect(blocked.body.error.code).toBe('IRN_MISSING');

    // The accounts team adds the PIN code to the customer's billing address, then tries again.
    await ctx.prisma.customerAddress.updateMany({ where: { customerId: noPin.id }, data: { pincode: '422007' } });
    const retried = (await accounts.post(`/invoices/${inv.id}/einvoice`).expect(200)).body;
    expect(retried.einvoice).toMatchObject({ status: 'GENERATED', attempts: 2, lastError: null });
    await accounts.post(`/invoices/${inv.id}/email`, { to: 'ravi@buyer.example' }).expect(200);
  }, 90000);

  it('registers a credit note against its invoice', async () => {
    const inv = await issuedInvoice(b2b.id);
    const after = (await accounts.post(`/invoices/${inv.id}/credit-notes`, { taxableAmount: '100', reason: 'Rate corrected' }).expect(200)).body;
    const cn = after.creditNotes[0];
    expect(cn.einvoice).toMatchObject({ status: 'GENERATED', test: true });
    const row = await ctx.prisma.eInvoice.findUniqueOrThrow({ where: { creditNoteId: cn.id } });
    expect(row.payload).toMatchObject({
      DocDtls: { Typ: 'CRN', No: cn.creditNoteNo },
      RefDtls: { PrecDocDtls: [{ InvNo: inv.invoiceNo }] },
      ValDtls: { AssVal: 100, CgstVal: 9, SgstVal: 9, TotInvVal: 118 },
    });
  }, 90000);

  it('cancels the IRN with the invoice within 24 hours, and refuses after that', async () => {
    const inv = await issuedInvoice(b2b.id);
    const noReason = await accounts.post(`/invoices/${inv.id}/cancel`, { version: inv.version, reason: 'Wrong customer' }).expect(422);
    expect(noReason.body.error.code).toBe('IRN_CANCEL_REASON');
    expect((await accounts.get(`/invoices/${inv.id}`).expect(200)).body.status).toBe('ISSUED');
    const cancelled = (await accounts.post(`/invoices/${inv.id}/cancel`, { version: inv.version, reason: 'Wrong customer', irnCancelReason: '2' }).expect(200)).body;
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.einvoice).toMatchObject({ status: 'CANCELLED', cancelReason: 'Data entry mistake: Wrong customer', cancellableUntil: null });
    await accounts.post(`/invoices/${inv.id}/einvoice`).expect(422);

    const old = await issuedInvoice(b2b.id);
    await ctx.prisma.eInvoice.update({ where: { invoiceId: old.id }, data: { ackDate: new Date(Date.now() - 25 * 3600_000) } });
    const late = await accounts.post(`/invoices/${old.id}/cancel`, { version: old.version, reason: 'Too late', irnCancelReason: '4' }).expect(422);
    expect(late.body.error.code).toBe('IRN_NOT_CANCELLABLE');
    expect(late.body.error.message).toMatch(/credit note/);
    expect((await accounts.get(`/invoices/${old.id}`).expect(200)).body).toMatchObject({ status: 'ISSUED', einvoice: { status: 'GENERATED', cancellableUntil: null } });
  }, 120000);

  it('does not register automatically when the lab turns that off', async () => {
    const s = (await admin.get('/admin/lab/einvoice').expect(200)).body;
    await admin.put('/admin/lab/einvoice', { seller: s.seller, autoOnIssue: false, sellerVersion: s.sellerVersion, autoOnIssueVersion: s.autoOnIssueVersion }).expect(200);
    const inv = await issuedInvoice(b2b.id);
    expect(inv).toMatchObject({ einvoiceRequired: true, einvoice: null });
    expect((await accounts.post(`/invoices/${inv.id}/einvoice`).expect(200)).body.einvoice.status).toBe('GENERATED');
  }, 90000);
});
