// Builds the GST e-invoice JSON (schema INV-01, version 1.1) for a tax invoice or credit note, and checks the
// document first so the lab sees a plain reason instead of an IRP error code. Pure functions: no database, no I/O.
import { Decimal } from 'decimal.js';
import { isValidGstin } from '../../common/india.js';

export type DocType = 'INV' | 'CRN';

export interface Party {
  gstin: string;
  legalName: string;
  tradeName?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  pincode: string;
  stateCode: string;
  phone?: string | null;
  email?: string | null;
}

export interface Line {
  description: string;
  sac: string;
  quantity: number;
  /** rate before discount */
  unitPrice: Decimal.Value;
  /** quantity × rate, before discount */
  amount: Decimal.Value;
}

export interface Document {
  type: DocType;
  no: string;
  date: Date;
  seller: Party;
  buyer: Party;
  /** buyer's place of supply (state code); decides IGST vs CGST + SGST together with the seller's state */
  placeOfSupplyCode: string;
  lines: Line[];
  gstRate: Decimal.Value;
  /** the document's own totals, exactly as printed; the item split must add up to these */
  totals: { discount: Decimal.Value; taxable: Decimal.Value; cgst: Decimal.Value; sgst: Decimal.Value; igst: Decimal.Value; roundOff: Decimal.Value; total: Decimal.Value };
  /** for a credit note: the invoice it corrects */
  precedingInvoice?: { no: string; date: Date } | null;
}

export interface Problem {
  field: string;
  message: string;
}

const money = (d: Decimal.Value) => new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const num = (d: Decimal.Value) => money(d).toNumber();
/** dd/mm/yyyy in India time, the only date format the IRP accepts */
export function irpDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('day')}/${get('month')}/${get('year')}`;
}

/** The IRP's document number rule: up to 16 characters of letters, digits, "/" and "-", not starting with 0, "/" or "-". */
export const DOC_NO_RE = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;
/** The IRP refuses double quotes and backslashes in text, and collapses nothing itself. */
const clip = (s: string | null | undefined, max: number) => (s ?? '').replace(/["\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Everything that would make the IRP refuse the document, in words a lab's accounts team can act on. */
export function checkDocument(doc: Document): Problem[] {
  const problems: Problem[] = [];
  if (!DOC_NO_RE.test(doc.no))
    problems.push({
      field: 'docNo',
      message: `The number ${doc.no} cannot be registered: the GST portal accepts at most 16 letters, digits, "/" or "-", not starting with 0, "/" or "-". Shorten the number format in Admin, Settings, Numbering.`,
    });
  const party = (p: Party, who: 'seller' | 'buyer') => {
    const label = who === 'seller' ? "The lab's" : "The customer's";
    if (!isValidGstin(p.gstin)) problems.push({ field: `${who}.gstin`, message: `${label} GSTIN ${p.gstin || '(empty)'} is not a valid GSTIN.` });
    else if (p.gstin.slice(0, 2) !== p.stateCode)
      problems.push({ field: `${who}.stateCode`, message: `${label} state (code ${p.stateCode}) does not match its GSTIN, which is registered in state ${p.gstin.slice(0, 2)}.` });
    if (clip(p.legalName, 100).length < 3) problems.push({ field: `${who}.legalName`, message: `${label} legal name is missing.` });
    if (clip(p.line1, 100).length < 1) problems.push({ field: `${who}.line1`, message: `${label} address is missing.` });
    if (clip(p.city, 50).length < 3) problems.push({ field: `${who}.city`, message: `${label} city or town is missing.` });
    if (!PIN_RE.test(p.pincode)) problems.push({ field: `${who}.pincode`, message: `${label} address needs a 6-digit PIN code.` });
  };
  party(doc.seller, 'seller');
  party(doc.buyer, 'buyer');
  if (doc.seller.gstin && doc.seller.gstin === doc.buyer.gstin) problems.push({ field: 'buyer.gstin', message: 'The customer has the same GSTIN as the lab.' });
  if (!doc.lines.length) problems.push({ field: 'lines', message: 'The document has no lines.' });
  if (doc.lines.some((l) => !/^[0-9]{4,8}$/.test(l.sac))) problems.push({ field: 'lines.sac', message: 'Every line needs a SAC code of 4 to 8 digits (Admin, Lab profile).' });
  if (doc.type === 'CRN' && !doc.precedingInvoice) problems.push({ field: 'precedingInvoice', message: 'A credit note must refer to the invoice it corrects.' });
  return problems;
}

/** Splits `total` over `weights` in proportion, to the paisa, so the parts add up exactly (largest remainder). */
export function allocate(total: Decimal.Value, weights: Decimal.Value[]): Decimal[] {
  const t = money(total);
  const w = weights.map((x) => new Decimal(x));
  const sum = Decimal.sum(0, ...w);
  if (sum.isZero()) return w.map((_, i) => (i === 0 ? t : new Decimal(0)));
  const exact = w.map((x) => t.times(x).div(sum));
  const floors = exact.map((x) => x.toDecimalPlaces(2, Decimal.ROUND_DOWN));
  let left = t
    .minus(Decimal.sum(0, ...floors))
    .times(100)
    .round()
    .toNumber();
  const order = exact.map((x, i) => ({ i, r: x.minus(floors[i]) })).sort((a, b) => b.r.comparedTo(a.r) || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = floors[i].plus('0.01');
    left--;
  }
  return floors;
}

const partyJson = (p: Party, who: 'seller' | 'buyer') => ({
  Gstin: p.gstin,
  LglNm: clip(p.legalName, 100),
  ...(p.tradeName ? { TrdNm: clip(p.tradeName, 100) } : {}),
  Addr1: clip(p.line1, 100),
  ...(clip(p.line2, 100).length >= 3 ? { Addr2: clip(p.line2, 100) } : {}),
  Loc: clip(p.city, who === 'buyer' ? 100 : 50),
  Pin: Number(p.pincode),
  Stcd: p.stateCode,
  ...(p.phone && /^[0-9]{6,12}$/.test(p.phone.replace(/\D/g, '')) ? { Ph: p.phone.replace(/\D/g, '').slice(-12) } : {}),
  ...(p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) && p.email.length <= 100 ? { Em: p.email } : {}),
});

/**
 * The INV-01 JSON. Discount and tax are worked out per line from the document's own totals (allocate), so the
 * lines add up exactly to what the invoice shows; the IRP checks both.
 */
export function buildPayload(doc: Document) {
  const amounts = doc.lines.map((l) => money(l.amount));
  const discounts = allocate(doc.totals.discount, amounts);
  const assessable = amounts.map((a, i) => a.minus(discounts[i]));
  const cgst = allocate(doc.totals.cgst, assessable);
  const sgst = allocate(doc.totals.sgst, assessable);
  const igst = allocate(doc.totals.igst, assessable);
  const rate = new Decimal(doc.gstRate).toNumber();
  const interState = new Decimal(doc.totals.igst).greaterThan(0) || doc.seller.stateCode !== doc.placeOfSupplyCode;
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: doc.type, No: doc.no, Dt: irpDate(doc.date) },
    SellerDtls: partyJson(doc.seller, 'seller'),
    BuyerDtls: { ...partyJson(doc.buyer, 'buyer'), Pos: doc.placeOfSupplyCode },
    ItemList: doc.lines.map((l, i) => {
      const tax = interState ? igst[i] : cgst[i].plus(sgst[i]);
      return {
        SlNo: String(i + 1),
        PrdDesc: clip(l.description, 300).length >= 3 ? clip(l.description, 300) : 'Testing service',
        IsServc: 'Y',
        HsnCd: l.sac,
        Qty: l.quantity || 1,
        Unit: 'OTH',
        // The IRP checks TotAmt = Qty × UnitPrice, so the price is taken from the line's amount (an amount agreed on a
        // quotation need not be a whole multiple of the list rate). Up to 3 decimals are allowed.
        UnitPrice: amounts[i]
          .div(l.quantity || 1)
          .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
          .toNumber(),
        TotAmt: num(amounts[i]),
        Discount: num(discounts[i]),
        AssAmt: num(assessable[i]),
        GstRt: rate,
        IgstAmt: num(interState ? igst[i] : 0),
        CgstAmt: num(interState ? 0 : cgst[i]),
        SgstAmt: num(interState ? 0 : sgst[i]),
        TotItemVal: num(assessable[i].plus(tax)),
      };
    }),
    ValDtls: {
      AssVal: num(doc.totals.taxable),
      CgstVal: num(doc.totals.cgst),
      SgstVal: num(doc.totals.sgst),
      IgstVal: num(doc.totals.igst),
      RndOffAmt: num(doc.totals.roundOff),
      TotInvVal: num(doc.totals.total),
    },
    ...(doc.type === 'CRN' && doc.precedingInvoice ? { RefDtls: { PrecDocDtls: [{ InvNo: doc.precedingInvoice.no, InvDt: irpDate(doc.precedingInvoice.date) }] } } : {}),
  };
}

export type InvPayload = ReturnType<typeof buildPayload>;
