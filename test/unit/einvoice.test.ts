import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { computeTax } from '../../src/modules/billing/tax.js';
import { aesDecrypt, aesEncrypt, duplicateIrn, NicIrp, parseIrpTime, readErrors } from '../../src/modules/einvoice/nic.js';
import { allocate, buildPayload, checkDocument, irpDate, type Document } from '../../src/modules/einvoice/payload.js';
import { IrpRejection, MockIrp } from '../../src/modules/einvoice/provider.js';
import { gstinCheckChar } from '../../src/common/india.js';

const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const SELLER = gstin('27AAAAA0000A1Z');
const BUYER_MH = gstin('27BBBBB1111B1Z');
const BUYER_KA = gstin('29CCCCC2222C1Z');

function doc(over: Partial<Document> = {}, buyer = BUYER_MH, lines = ['1500.00', '2499.50', '760.00'], discountPct = '5'): Document {
  const t = computeTax({ amounts: lines, discountPct, gstRate: 18, customerStateCode: buyer.slice(0, 2), labStateCode: '27' });
  return {
    type: 'INV',
    no: 'AE/26-27/00042',
    date: new Date('2026-11-12T00:00:00+05:30'),
    seller: {
      gstin: SELLER,
      legalName: 'Example Testing Labs Private Limited',
      line1: 'Plot 4, MIDC',
      city: 'Pune',
      pincode: '411019',
      stateCode: '27',
      phone: '+91 20 1234 5678',
      email: 'lab@example.com',
    },
    buyer: {
      gstin: buyer,
      legalName: 'Contoso "Forgings" Ltd',
      line1: 'Unit 7\\B, Industrial Area',
      city: 'Bengaluru',
      pincode: buyer.startsWith('29') ? '560058' : '411026',
      stateCode: buyer.slice(0, 2),
    },
    placeOfSupplyCode: buyer.slice(0, 2),
    lines: lines.map((a, i) => ({ description: `S-${i} · Tensile test`, sac: '998346', quantity: 1, unitPrice: a, amount: a })),
    gstRate: 18,
    totals: { discount: t.discountAmount, taxable: t.taxableAmount, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff, total: t.grandTotal },
    ...over,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => new Decimal(a).plus(b).toNumber(), 0);

describe('INV-01 payload', () => {
  it('splits discount and tax over the lines so they add up exactly to the invoice, within the IRP rules', () => {
    const d = doc();
    const p = buildPayload(d);
    expect(sum(p.ItemList.map((i) => i.AssAmt))).toBe(p.ValDtls.AssVal);
    expect(sum(p.ItemList.map((i) => i.CgstAmt))).toBe(p.ValDtls.CgstVal);
    expect(sum(p.ItemList.map((i) => i.SgstAmt))).toBe(p.ValDtls.SgstVal);
    expect(p.ValDtls.IgstVal).toBe(0);
    for (const i of p.ItemList) {
      expect(new Decimal(i.TotAmt).minus(i.Discount).toNumber()).toBe(i.AssAmt); // 2193
      expect(Math.abs(new Decimal(i.Qty).times(i.UnitPrice).minus(i.TotAmt).toNumber())).toBeLessThan(1); // 2192
      expect(new Decimal(i.AssAmt).plus(i.CgstAmt).plus(i.SgstAmt).plus(i.IgstAmt).toNumber()).toBe(i.TotItemVal); // 2194
      expect(Math.abs(new Decimal(i.AssAmt).times(9).div(100).minus(i.CgstAmt).toNumber())).toBeLessThan(1);
    }
    // 2189: TotInvVal = Σ TotItemVal + round-off
    expect(new Decimal(sum(p.ItemList.map((i) => i.TotItemVal))).plus(p.ValDtls.RndOffAmt).toNumber()).toBe(p.ValDtls.TotInvVal);
    expect(p.TranDtls).toEqual({ TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' });
    expect(p.DocDtls).toEqual({ Typ: 'INV', No: 'AE/26-27/00042', Dt: '12/11/2026' });
    expect(p.BuyerDtls.Pos).toBe('27');
    expect(p.ItemList[0]).toMatchObject({ SlNo: '1', IsServc: 'Y', HsnCd: '998346', GstRt: 18, Unit: 'OTH' });
  });

  it('uses IGST only when the customer is in another state', () => {
    const p = buildPayload(doc({}, BUYER_KA));
    expect(p.ValDtls.CgstVal).toBe(0);
    expect(p.ValDtls.SgstVal).toBe(0);
    expect(p.ValDtls.IgstVal).toBeGreaterThan(0);
    expect(sum(p.ItemList.map((i) => i.IgstAmt))).toBe(p.ValDtls.IgstVal);
    expect(p.ItemList.every((i) => i.CgstAmt === 0 && i.SgstAmt === 0)).toBe(true);
    expect(p.BuyerDtls.Pos).toBe('29');
  });

  it('takes the unit price from an agreed amount that is not a whole multiple of the rate', () => {
    const d = doc();
    d.lines[0] = { ...d.lines[0], quantity: 3, unitPrice: '500', amount: '1500.00' };
    d.lines[1] = { ...d.lines[1], quantity: 3, unitPrice: '900', amount: '2499.50' };
    const p = buildPayload(d);
    expect(p.ItemList[1]).toMatchObject({ Qty: 3, UnitPrice: 833.167, TotAmt: 2499.5 });
  });

  it('removes the characters the IRP refuses and keeps fields to their lengths', () => {
    const p = buildPayload(doc());
    expect(p.BuyerDtls.LglNm).toBe('Contoso Forgings Ltd');
    expect(p.BuyerDtls.Addr1).toBe('Unit 7B, Industrial Area');
    expect(p.SellerDtls.Ph).toBe('912012345678');
    expect(p.SellerDtls.Pin).toBe(411019);
    expect(JSON.stringify(p)).not.toMatch(/\\\\|\\"/);
  });

  it('refers a credit note to its invoice', () => {
    const p = buildPayload(doc({ type: 'CRN', no: 'AE/CN/26-27/001', precedingInvoice: { no: 'AE/26-27/00042', date: new Date('2026-11-01T00:00:00+05:30') } }));
    expect(p.DocDtls.Typ).toBe('CRN');
    expect(p.RefDtls).toEqual({ PrecDocDtls: [{ InvNo: 'AE/26-27/00042', InvDt: '01/11/2026' }] });
  });

  it('allocates to the paisa by largest remainder', () => {
    expect(allocate('100.00', [1, 1, 1]).map(String)).toEqual(['33.34', '33.33', '33.33']);
    expect(allocate('0.05', [3, 1]).map(String)).toEqual(['0.04', '0.01']);
    expect(allocate('10', [0, 0]).map(String)).toEqual(['10', '0']);
  });

  it('writes dates in India time', () => {
    expect(irpDate(new Date('2026-03-31T20:00:00Z'))).toBe('01/04/2026');
  });
});

describe('document checks', () => {
  it('passes a complete document', () => {
    expect(checkDocument(doc())).toEqual([]);
  });

  it('explains each problem in words', () => {
    const d = doc({ no: 'AE/INV/26-27/00042' });
    d.buyer = { ...d.buyer, pincode: '', city: '' };
    d.seller = { ...d.seller, gstin: '27AAAAA0000A1ZX' };
    const messages = checkDocument(d).map((p) => p.message);
    expect(messages.join('\n')).toMatch(/at most 16 letters/);
    expect(messages.join('\n')).toMatch(/customer's address needs a 6-digit PIN code/);
    expect(messages.join('\n')).toMatch(/customer's city/);
    expect(messages.join('\n')).toMatch(/lab's GSTIN .* is not a valid GSTIN/);
  });

  it('catches a GSTIN registered in another state than the address', () => {
    const d = doc();
    d.buyer = { ...d.buyer, stateCode: '29' };
    expect(checkDocument(d).map((p) => p.field)).toContain('buyer.stateCode');
  });

  it('accepts only the IRP document number pattern', () => {
    for (const ok of ['AE/26-27/00001', 'INV-1', 'A', 'a2b/3-4']) expect(checkDocument(doc({ no: ok })).some((p) => p.field === 'docNo')).toBe(false);
    for (const bad of ['0AE/1', '/AE', '-AE', 'AE 26', 'AE_26', 'A'.repeat(17)]) expect(checkDocument(doc({ no: bad })).some((p) => p.field === 'docNo')).toBe(true);
  });
});

describe('mock IRP', () => {
  it('makes the same test IRN for the same document, and marks it as a test', async () => {
    const p = buildPayload(doc());
    const a = await new MockIrp().generate(p);
    expect(a.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(MockIrp.irnFor(p)).toBe(a.irn);
    expect(Buffer.from(a.signedQrCode.split('.')[1], 'base64url').toString()).toContain('Not registered with the GST portal');
  });
});

describe('NIC IRP protocol', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const config = {
    provider: 'nic' as const,
    environment: 'sandbox' as const,
    baseUrl: 'https://irp.test',
    clientId: 'cid',
    clientSecret: 'csecret',
    username: 'api_user',
    password: 'p@ss',
    gstin: SELLER,
    publicKey,
  };

  /** A small IRP: does the server side of the published encryption scheme. */
  function fakeIrp(opts: { duplicate?: boolean; expireFirstToken?: boolean } = {}) {
    const sek = Buffer.alloc(32, 7);
    let tokens = 0;
    const calls: { path: string; headers: Record<string, string>; body: unknown }[] = [];
    const reply = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    const http = (async (url: string, init: RequestInit) => {
      const path = url.replace(config.baseUrl, '');
      const headers = init.headers as Record<string, string>;
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, headers, body });
      if (path === '/eivital/v1.04/auth') {
        // JSON → base64 → RSA PKCS#1 v1.5 → base64
        const inner = JSON.parse(Buffer.from(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(body.Data, 'base64')).toString(), 'base64').toString());
        expect(inner).toMatchObject({ UserName: 'api_user', Password: 'p@ss', ForceRefreshAccessToken: true });
        const appKey = Buffer.from(inner.AppKey, 'base64');
        expect(appKey).toHaveLength(32);
        tokens++;
        return reply({ Status: 1, Data: { ClientId: 'cid', UserName: 'api_user', AuthToken: `token-${tokens}`, Sek: aesEncrypt(appKey, sek), TokenExpiry: '2099-01-01 10:00:00' } });
      }
      if (opts.expireFirstToken && headers.AuthToken === 'token-1') return reply({ Status: 0, ErrorDetails: [{ ErrorCode: '1005', ErrorMessage: 'Invalid Token' }] });
      if (path === '/eicore/v1.03/Invoice') {
        const inv = JSON.parse(aesDecrypt(sek, body.Data).toString());
        if (opts.duplicate)
          return reply({
            Status: 0,
            ErrorDetails: Buffer.from(JSON.stringify([{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }])).toString('base64'),
            InfoDtls: [{ InfCd: 'DUPIRN', Desc: { AckNo: 112010000000001, AckDt: '2026-11-12 10:00:00', Irn: 'a'.repeat(64) } }],
          });
        return reply({
          Status: 1,
          Data: aesEncrypt(
            sek,
            Buffer.from(
              JSON.stringify({ AckNo: 112010036221234, AckDt: '2026-11-12 15:04:05', Irn: 'b'.repeat(64), SignedInvoice: 'signed.inv.jwt', SignedQRCode: `qr-for-${inv.DocDtls.No}`, Status: 'ACT' }),
            ),
          ),
        });
      }
      if (path === `/eicore/v1.03/Invoice/irn/${'a'.repeat(64)}`)
        return reply({
          Status: 1,
          Data: aesEncrypt(sek, Buffer.from(JSON.stringify({ AckNo: 112010000000001, AckDt: '2026-11-12 10:00:00', Irn: 'a'.repeat(64), SignedInvoice: 'x', SignedQRCode: 'y' }))),
        });
      if (path === '/eicore/v1.03/Invoice/Cancel') {
        const c = JSON.parse(aesDecrypt(sek, body.Data).toString());
        return reply({ Status: 1, Data: aesEncrypt(sek, Buffer.from(JSON.stringify({ Irn: c.Irn, CancelDate: '2026-11-12 16:00:00', echo: c }))) });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return { http, calls, tokens: () => tokens };
  }

  it('signs in, sends the invoice encrypted with the session key, and reads the registration', async () => {
    const irp = fakeIrp();
    const nic = new NicIrp(config, irp.http);
    const reg = await nic.generate(buildPayload(doc()));
    expect(reg).toMatchObject({ irn: 'b'.repeat(64), ackNo: '112010036221234', signedQrCode: 'qr-for-AE/26-27/00042' });
    expect(reg.ackDate.toISOString()).toBe('2026-11-12T09:34:05.000Z');
    const gen = irp.calls.find((c) => c.path === '/eicore/v1.03/Invoice')!;
    expect(gen.headers).toMatchObject({ client_id: 'cid', client_secret: 'csecret', Gstin: SELLER, user_name: 'api_user', AuthToken: 'token-1' });
    expect(JSON.stringify(gen.body)).not.toContain('Contoso');
    // The session is reused
    await nic.generate(buildPayload(doc({ no: 'AE/26-27/00043' })));
    expect(irp.tokens()).toBe(1);
  });

  it('signs in again once when the token is refused', async () => {
    const irp = fakeIrp({ expireFirstToken: true });
    const reg = await new NicIrp(config, irp.http).generate(buildPayload(doc()));
    expect(reg.irn).toBe('b'.repeat(64));
    expect(irp.tokens()).toBe(2);
  });

  it('reports a duplicate with the IRN the IRP already has, which can then be fetched', async () => {
    const irp = fakeIrp({ duplicate: true });
    const nic = new NicIrp(config, irp.http);
    const err = await nic.generate(buildPayload(doc())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IrpRejection);
    expect((err as IrpRejection).codes).toEqual(['2150']);
    expect((err as IrpRejection).existingIrn).toBe('a'.repeat(64));
    expect((await nic.fetch('a'.repeat(64))).ackNo).toBe('112010000000001');
  });

  it('cancels with the reason code and a cleaned remark', async () => {
    const irp = fakeIrp();
    const res = await new NicIrp(config, irp.http).cancel('b'.repeat(64), '2', 'Wrong "rate" \\ entered');
    expect(res.cancelledAt.toISOString()).toBe('2026-11-12T10:30:00.000Z');
  });

  it('reads both shapes of error details and the duplicate info', () => {
    expect(readErrors([{ ErrorCode: 2150, ErrorMessage: 'Duplicate IRN' }])).toEqual([{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }]);
    expect(readErrors(Buffer.from(JSON.stringify([{ ErrorCode: '3028', ErrorMessage: 'GSTIN is not present' }])).toString('base64'))[0].ErrorCode).toBe('3028');
    expect(duplicateIrn([{ InfCd: 'DUPIRN', Desc: JSON.stringify({ Irn: 'c'.repeat(64) }) }])).toBe('c'.repeat(64));
    expect(duplicateIrn(null)).toBeNull();
    expect(parseIrpTime('2026-11-12 00:00:00').toISOString()).toBe('2026-11-11T18:30:00.000Z');
  });
});
