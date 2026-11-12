// The two ways to reach an IRP. Both take the INV-01 JSON and return what the IRP registered.
import { createHash, randomInt } from 'node:crypto';
import type { InvPayload } from './payload.js';

export interface Registered {
  irn: string;
  ackNo: string;
  ackDate: Date;
  signedInvoice: string;
  signedQrCode: string;
}

/** Why a document is being cancelled, as the IRP codes it. */
export const CANCEL_REASONS = { '1': 'Duplicate', '2': 'Data entry mistake', '3': 'Order cancelled', '4': 'Others' } as const;
export type CancelReason = keyof typeof CANCEL_REASONS;

/** An answer from the IRP that is a decision about the document (not a network or login failure). */
export class IrpRejection extends Error {
  constructor(
    message: string,
    public readonly codes: string[],
    /** set when the IRP says this document already has an IRN (duplicate), so it can be fetched instead */
    public readonly existingIrn: string | null = null,
  ) {
    super(message);
    this.name = 'IrpRejection';
  }
}

export interface IrpProvider {
  readonly name: 'nic' | 'mock';
  generate(payload: InvPayload): Promise<Registered>;
  /** The registration of a document that already has an IRN (after a duplicate answer). */
  fetch(irn: string): Promise<Registered>;
  cancel(irn: string, reason: CancelReason, remark: string): Promise<{ cancelledAt: Date }>;
  /** Signs in only, to prove the credentials work. */
  check(): Promise<void>;
}

const b64url = (s: string) => Buffer.from(s).toString('base64url');

/**
 * Test IRNs made on this server, for development and demos. Nothing is sent anywhere, the IRN is not registered,
 * and the QR code says so; documents with a mock IRN print "TEST" next to it. Stateless: the database already stops
 * a document being registered twice.
 */
export class MockIrp implements IrpProvider {
  readonly name = 'mock' as const;

  /** Like the real IRN, a SHA-256 hash over the seller GSTIN, financial year, document type and number. */
  static irnFor(payload: InvPayload): string {
    const [, m, y] = payload.DocDtls.Dt.split('/').map(Number);
    const start = m >= 4 ? y : y - 1;
    return createHash('sha256')
      .update(`${payload.SellerDtls.Gstin}${start}-${String((start + 1) % 100).padStart(2, '0')}${payload.DocDtls.Typ}${payload.DocDtls.No.toUpperCase()}`)
      .digest('hex');
  }

  async generate(payload: InvPayload): Promise<Registered> {
    const irn = MockIrp.irnFor(payload);
    const ackDate = new Date();
    const qr = {
      SellerGstin: payload.SellerDtls.Gstin,
      BuyerGstin: payload.BuyerDtls.Gstin,
      DocNo: payload.DocDtls.No,
      DocTyp: payload.DocDtls.Typ,
      DocDt: payload.DocDtls.Dt,
      TotInvVal: payload.ValDtls.TotInvVal,
      ItemCnt: payload.ItemList.length,
      MainHsnCode: payload.ItemList[0]?.HsnCd,
      Irn: irn,
      IrnDt: ackDate.toISOString(),
      TEST: 'Not registered with the GST portal',
    };
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'MOCK-NOT-REGISTERED' }));
    return {
      irn,
      ackNo: `99${String(Date.now()).slice(-10)}${String(randomInt(1000)).padStart(3, '0')}`,
      ackDate,
      signedInvoice: `${header}.${b64url(JSON.stringify({ data: JSON.stringify(payload) }))}.`,
      signedQrCode: `${header}.${b64url(JSON.stringify({ data: JSON.stringify(qr) }))}.`,
    };
  }

  async fetch(irn: string): Promise<Registered> {
    throw new IrpRejection(`The test provider keeps no record of ${irn}`, []);
  }

  async cancel(): Promise<{ cancelledAt: Date }> {
    return { cancelledAt: new Date() };
  }

  async check(): Promise<void> {}
}
