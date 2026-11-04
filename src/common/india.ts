/** Indian regional helpers: financial year, dates, digit grouping, amount in words, GSTIN. */
import { Decimal } from 'decimal.js';

export const TIME_ZONE = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar parts of an instant, in IST. */
export function istParts(d: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Today's calendar date in IST as a UTC-midnight Date (the shape @db.Date columns use). */
export function istToday(now: Date = new Date()): Date {
  const p = istParts(now);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}

/** Formats as DD-Mon-YYYY. Date-only values (UTC midnight) print as stored; instants print in IST. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  const isDateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  const p = isDateOnly ? { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() } : istParts(d);
  return `${String(p.d).padStart(2, '0')}-${MONTHS[p.m - 1]}-${p.y}`;
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  const p = istParts(d);
  return `${String(p.d).padStart(2, '0')}-${MONTHS[p.m - 1]}-${p.y} ${time} IST`;
}

/** Indian financial year label, April to March, e.g. "26-27". */
export function financialYear(d: Date = new Date()): string {
  const p = istParts(d);
  const start = p.m >= 4 ? p.y : p.y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Indian digit grouping with two decimals: 123456 -> 1,23,456.00 */
export function formatINR(value: Decimal.Value): string {
  const d = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const negative = d.isNegative() && !d.isZero();
  const [int, frac] = d.abs().toFixed(2).split('.');
  let grouped = int;
  if (int.length > 3) {
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  return `${negative ? '-' : ''}${grouped}.${frac}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const unit = n % 10;
  return unit ? `${TENS[Math.floor(n / 10)]}-${ONES[unit]}` : TENS[Math.floor(n / 10)];
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? belowHundred(r) : ''].filter(Boolean).join(' ');
}

function integerToWords(input: Decimal): string {
  if (input.isZero()) return 'Zero';
  const parts: string[] = [];
  let n = input;
  const crore = n.dividedToIntegerBy(10_000_000);
  n = n.minus(crore.times(10_000_000));
  if (!crore.isZero()) parts.push(`${integerToWords(crore)} Crore`);
  const lakh = n.dividedToIntegerBy(100_000).toNumber();
  n = n.minus(new Decimal(lakh).times(100_000));
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = n.dividedToIntegerBy(1000).toNumber();
  n = n.minus(new Decimal(thousand).times(1000));
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (!n.isZero()) parts.push(belowThousand(n.toNumber()));
  return parts.join(' ');
}

/** "Fifteen Thousand Five Hundred Seventy-Six Only"; paise are included when present. */
export function amountInWords(value: Decimal.Value): string {
  const d = new Decimal(value).abs().toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const rupees = d.floor();
  const paise = d.minus(rupees).times(100).round().toNumber();
  const words = integerToWords(rupees);
  return paise ? `${words} and ${belowHundred(paise)} Paise Only` : `${words} Only`;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Check character per the published GSTN mod-36 algorithm. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(value / 36) + (value % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(gstin: string): boolean {
  if (!GSTIN_RE.test(gstin)) return false;
  return gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
