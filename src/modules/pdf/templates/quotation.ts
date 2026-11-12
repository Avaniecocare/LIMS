import type { CompanySnapshot } from '../../../config/company.config.js';
import { formatDate, formatINR } from '../../../common/india.js';
import { bankBlock, customerBlock, esc, letterhead, multiline, page, taxTotalsTable, type CustomerSnapshot } from './base.js';

export interface QuotationPdf {
  quotationNo: string;
  versionNo: number;
  documentTitle: string;
  date: Date | string;
  validUntil: Date | string;
  estimatedDays: number | null;
  paymentTerms: string | null;
  deliveryAddress: string | null;
  contactPerson: string | null;
  subtotal: unknown;
  discountAmount: unknown;
  taxableAmount: unknown;
  gstRate: unknown;
  cgst: unknown;
  sgst: unknown;
  igst: unknown;
  roundOff: unknown;
  grandTotal: unknown;
  amountInWords: string;
  terms: string | null;
  customer: CustomerSnapshot;
  company: CompanySnapshot;
  lines: {
    seq: number;
    sampleDescription: string;
    requiredQuantity: string | null;
    testName: string;
    methodName: string | null;
    quantity: number;
    rate: unknown;
    discountPct: unknown;
    amount: unknown;
  }[];
}

export function quotationHtml(q: QuotationPdf): string {
  const rows = q.lines
    .map(
      (l) => `<tr><td class="center">${l.seq}</td><td>${esc(l.sampleDescription)}${l.requiredQuantity ? `<br><span class="muted small">Required: ${esc(l.requiredQuantity)}</span>` : ''}</td>
      <td>${esc(l.testName)}</td><td>${esc(l.methodName)}</td><td class="right">${l.quantity}</td><td class="right">${formatINR(String(l.rate))}</td>
      ${Number(l.discountPct) ? `<td class="right">${esc(Number(l.discountPct))}%</td>` : '<td class="right">—</td>'}<td class="right">${formatINR(String(l.amount))}</td></tr>`,
    )
    .join('');
  const body = `${letterhead(q.company)}<h1>${esc(q.documentTitle)}</h1>
  <table class="plain" style="margin:6px 0"><tr><td><span class="bold">No.:</span> ${esc(q.quotationNo)}${q.versionNo > 1 ? ` (Revision ${q.versionNo - 1})` : ''}</td>
  <td class="right"><span class="bold">Date:</span> ${formatDate(q.date)} &nbsp; <span class="bold">Valid until:</span> ${formatDate(q.validUntil)}</td></tr></table>
  ${customerBlock(q.customer)}
  <h2>Tests and rates</h2>
  <table><thead><tr><th class="center">S.No</th><th>Sample</th><th>Test</th><th>Method</th><th class="right">Qty</th><th class="right">Rate (₹)</th><th class="right">Disc.</th><th class="right">Amount (₹)</th></tr></thead><tbody>${rows}</tbody></table>
  ${taxTotalsTable(q, formatINR as never)}
  <p class="bold">Amount in words: Rupees ${esc(q.amountInWords)}</p>
  <div class="grid keep"><div>
    <table class="plain small">
    ${q.estimatedDays ? `<tr><td class="bold">Estimated duration</td><td>${q.estimatedDays} days</td></tr>` : ''}
    ${q.paymentTerms ? `<tr><td class="bold">Payment terms</td><td>${esc(q.paymentTerms)}</td></tr>` : ''}
    ${q.deliveryAddress ? `<tr><td class="bold">Send samples to</td><td>${multiline(q.deliveryAddress)}</td></tr>` : ''}
    ${q.contactPerson ? `<tr><td class="bold">Contact person</td><td>${esc(q.contactPerson)}</td></tr>` : ''}
    <tr><td class="bold">SAC</td><td>${esc(q.company.sacCode)} — ${esc(q.company.sacDescription)}</td></tr>
    </table></div><div>${bankBlock(q.company)}</div></div>
  ${q.terms ? `<h2>Terms and conditions</h2><div class="terms">${esc(q.terms)}</div>` : ''}
  <p class="right" style="margin-top:20px">For <span class="bold">${esc(q.company.legalName)}</span></p>`;
  return page(`${q.documentTitle} ${q.quotationNo}`, q.company, body);
}
