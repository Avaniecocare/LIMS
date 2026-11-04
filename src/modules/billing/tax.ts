import { Decimal } from 'decimal.js';
import { amountInWords } from '../../common/india.js';

const money = (d: Decimal.Value) => new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export interface TaxInput {
  /** line amounts, already net of line discount */
  amounts: Decimal.Value[];
  discountPct?: Decimal.Value;
  gstRate: Decimal.Value;
  customerStateCode: string;
  labStateCode: string;
}

export interface TaxTotals {
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  gstRate: string;
  isInterState: boolean;
  cgst: string;
  sgst: string;
  igst: string;
  roundOff: string;
  grandTotal: string;
  amountInWords: string;
}

/**
 * GST from place of supply: CGST + SGST when customer state equals the lab's state, IGST otherwise.
 * The half rates are computed from one total so CGST and SGST always agree; the grand total rounds
 * to the nearest rupee and the difference is shown as round-off.
 */
export function computeTax(input: TaxInput): TaxTotals {
  const subtotal = money(Decimal.sum(0, ...input.amounts));
  const discountAmount = money(subtotal.times(input.discountPct ?? 0).div(100));
  const taxable = subtotal.minus(discountAmount);
  const rate = new Decimal(input.gstRate);
  const isInterState = input.customerStateCode !== input.labStateCode;
  let cgst = new Decimal(0);
  let sgst = new Decimal(0);
  let igst = new Decimal(0);
  if (isInterState) {
    igst = money(taxable.times(rate).div(100));
  } else {
    cgst = money(taxable.times(rate).div(200));
    sgst = cgst;
  }
  const exact = taxable.plus(cgst).plus(sgst).plus(igst);
  const grand = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return {
    subtotal: subtotal.toFixed(2),
    discountAmount: discountAmount.toFixed(2),
    taxableAmount: taxable.toFixed(2),
    gstRate: rate.toFixed(3),
    isInterState,
    cgst: cgst.toFixed(2),
    sgst: sgst.toFixed(2),
    igst: igst.toFixed(2),
    roundOff: grand.minus(exact).toFixed(2),
    grandTotal: grand.toFixed(2),
    amountInWords: amountInWords(grand),
  };
}

export function lineAmount(quantity: number, rate: Decimal.Value, discountPct: Decimal.Value = 0): string {
  const gross = new Decimal(rate).times(quantity);
  return money(gross.minus(gross.times(discountPct).div(100))).toFixed(2);
}
