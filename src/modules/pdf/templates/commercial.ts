import type { CompanySnapshot } from '../../../config/company.config.js';
import { formatDate, formatINR } from '../../../common/india.js';
import { bankBlock, customerBlock, esc, letterhead, multiline, page, taxTotalsTable, type CustomerSnapshot } from './base.js';

export interface InvoicePdf {
  invoiceNo: string | null;
  draft: boolean;
  invoiceDate: Date | string | null;
  dueDate: Date | string | null;
  placeOfSupply: string;
  placeOfSupplyCode: string;
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
  notes: string | null;
  terms: string | null;
  company: CompanySnapshot;
  customer: CustomerSnapshot;
  lines: { seq: number; description: string; sacCode: string; quantity: number; rate: unknown; amount: unknown }[];
}

export function invoiceHtml(i: InvoicePdf): string {
  const rows = i.lines
    .map(
      (l) =>
        `<tr><td class="center">${l.seq}</td><td>${esc(l.description)}</td><td>${esc(l.sacCode)}</td><td class="right">${l.quantity}</td><td class="right">${formatINR(String(l.rate))}</td><td class="right">${formatINR(String(l.amount))}</td></tr>`,
    )
    .join('');
  return page(
    `Tax Invoice ${i.invoiceNo ?? 'Draft'}`,
    i.company,
    `${letterhead(i.company)}<h1>Tax Invoice${i.draft ? ' — DRAFT' : ''}</h1>
  <table class="plain" style="margin:6px 0"><tr><td><span class="bold">Invoice no.:</span> ${esc(i.invoiceNo ?? 'Not issued')}</td><td class="right"><span class="bold">Date:</span> ${formatDate(i.invoiceDate)} &nbsp; <span class="bold">Due:</span> ${formatDate(i.dueDate)}</td></tr>
  <tr><td><span class="bold">Place of supply:</span> ${esc(i.placeOfSupply)} (${esc(i.placeOfSupplyCode)})</td><td class="right"><span class="bold">Reverse charge:</span> No</td></tr></table>
  ${customerBlock(i.customer, 'Bill to')}
  <h2>Services</h2><table><thead><tr><th class="center">S.No</th><th>Description</th><th>SAC</th><th class="right">Qty</th><th class="right">Rate (₹)</th><th class="right">Taxable value (₹)</th></tr></thead><tbody>${rows}</tbody></table>
  ${taxTotalsTable(i, formatINR as never)}
  <p class="bold">Amount in words: Rupees ${esc(i.amountInWords)}</p>
  ${i.notes ? `<p>${multiline(i.notes)}</p>` : ''}
  <div class="grid keep"><div>${bankBlock(i.company)}</div><div class="right"><p>For <span class="bold">${esc(i.company.legalName)}</span></p><p style="margin-top:34px">Authorised Signatory</p></div></div>
  ${i.terms ? `<h2>Terms and conditions</h2><div class="terms">${esc(i.terms)}</div>` : ''}`,
  );
}

export interface CreditNotePdf {
  creditNoteNo: string;
  issuedOn: Date | string;
  invoiceNo: string | null;
  invoiceDate: Date | string | null;
  reason: string;
  taxableAmount: unknown;
  gstRate: unknown;
  cgst: unknown;
  sgst: unknown;
  igst: unknown;
  roundOff: unknown;
  total: unknown;
  amountInWords: string;
  company: CompanySnapshot;
  customer: CustomerSnapshot;
}

export function creditNoteHtml(c: CreditNotePdf): string {
  const totals = {
    subtotal: c.taxableAmount,
    discountAmount: 0,
    taxableAmount: c.taxableAmount,
    gstRate: c.gstRate,
    cgst: c.cgst,
    sgst: c.sgst,
    igst: c.igst,
    roundOff: c.roundOff,
    grandTotal: c.total,
  };
  return page(
    `Credit Note ${c.creditNoteNo}`,
    c.company,
    `${letterhead(c.company)}<h1>Credit Note</h1>
  <table class="plain" style="margin:6px 0"><tr><td><span class="bold">Credit note no.:</span> ${esc(c.creditNoteNo)}</td><td class="right"><span class="bold">Date:</span> ${formatDate(c.issuedOn)}</td></tr>
  <tr><td><span class="bold">Against invoice:</span> ${esc(c.invoiceNo)} dated ${formatDate(c.invoiceDate)}</td><td></td></tr></table>
  ${customerBlock(c.customer, 'Customer')}<h2>Reason</h2><p>${multiline(c.reason)}</p>
  ${taxTotalsTable(totals, formatINR as never, 'Taxable value', 'Credit note total (₹)')}<p class="bold">Amount in words: Rupees ${esc(c.amountInWords)}</p>
  <p class="right" style="margin-top:28px">For <span class="bold">${esc(c.company.legalName)}</span></p>`,
  );
}

export interface StatementPdf {
  company: CompanySnapshot;
  customerName: string;
  crn: string;
  gstin: string | null;
  from: Date | string | null;
  to: Date | string;
  entries: { date: Date | string; type: string; reference: string; debit: string | null; credit: string | null; balance: string }[];
  closingBalance: string;
  ageing: { bucket: string; amount: string }[];
}

export function statementHtml(s: StatementPdf): string {
  const rows = s.entries
    .map(
      (e) =>
        `<tr><td>${formatDate(e.date)}</td><td>${esc(e.type)}</td><td>${esc(e.reference)}</td><td class="right">${e.debit ? formatINR(e.debit) : ''}</td><td class="right">${e.credit ? formatINR(e.credit) : ''}</td><td class="right">${formatINR(e.balance)}</td></tr>`,
    )
    .join('');
  return page(
    `Statement of Account ${s.crn}`,
    s.company,
    `${letterhead(s.company)}<h1>Statement of Account</h1>
  <table class="plain" style="margin:6px 0"><tr><td><span class="bold">Customer:</span> ${esc(s.customerName)} (${esc(s.crn)})${s.gstin ? `<br>GSTIN: ${esc(s.gstin)}` : ''}</td><td class="right"><span class="bold">Period:</span> ${s.from ? formatDate(s.from) : 'Opening'} to ${formatDate(s.to)}</td></tr></table>
  <table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th class="right">Debit (₹)</th><th class="right">Credit (₹)</th><th class="right">Balance (₹)</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="center">No transactions in this period.</td></tr>'}</tbody></table>
  <table class="totals"><tr class="bold"><td>Closing balance (₹)</td><td class="right">${formatINR(s.closingBalance)}</td></tr></table>
  <h2>Ageing of outstanding invoices</h2><table class="keep"><thead><tr>${s.ageing.map((a) => `<th class="right">${esc(a.bucket)}</th>`).join('')}</tr></thead><tbody><tr>${s.ageing.map((a) => `<td class="right">${formatINR(a.amount)}</td>`).join('')}</tr></tbody></table>
  <div class="keep" style="margin-top:12px">${bankBlock(s.company)}</div>`,
  );
}

export interface ChallanPdf {
  dispatchNo: string;
  dispatchDate: Date | string;
  jobNo: string;
  modeLabel: string;
  courierName: string | null;
  carrierName: string | null;
  docketNo: string | null;
  carrierContact: string | null;
  remarks: string | null;
  customerName: string;
  address: string | null;
  items: { kind: string; reference: string; description: string }[];
  company: CompanySnapshot;
}

export function challanHtml(c: ChallanPdf): string {
  return page(
    `Dispatch Challan ${c.dispatchNo}`,
    c.company,
    `${letterhead(c.company)}<h1>Dispatch Challan</h1>
  <table class="plain" style="margin:6px 0"><tr><td><span class="bold">Challan no.:</span> ${esc(c.dispatchNo)}</td><td class="right"><span class="bold">Date:</span> ${formatDate(c.dispatchDate)}</td></tr><tr><td><span class="bold">Job no.:</span> ${esc(c.jobNo)}</td><td></td></tr></table>
  <div class="grid"><div class="box"><div class="bold">To</div><div class="bold">${esc(c.customerName)}</div><div>${multiline(c.address)}</div></div>
  <div class="box"><table class="plain"><tr><td class="bold">Mode</td><td>${esc(c.modeLabel)}</td></tr>
  ${c.courierName ? `<tr><td class="bold">Courier</td><td>${esc(c.courierName)}</td></tr>` : ''}${c.docketNo ? `<tr><td class="bold">Docket no.</td><td>${esc(c.docketNo)}</td></tr>` : ''}
  ${c.carrierName ? `<tr><td class="bold">Carried by</td><td>${esc(c.carrierName)}</td></tr>` : ''}${c.carrierContact ? `<tr><td class="bold">Contact</td><td>${esc(c.carrierContact)}</td></tr>` : ''}</table></div></div>
  <h2>Items</h2><table><thead><tr><th class="center">S.No</th><th>Item</th><th>Reference</th><th>Description</th></tr></thead><tbody>${c.items.map((it, i) => `<tr><td class="center">${i + 1}</td><td>${esc(it.kind)}</td><td>${esc(it.reference)}</td><td>${esc(it.description)}</td></tr>`).join('')}</tbody></table>
  ${c.remarks ? `<p><span class="bold">Remarks:</span> ${multiline(c.remarks)}</p>` : ''}
  <table class="plain keep" style="margin-top:34px"><tr><td>Dispatched by: ______________________</td><td class="right">Received by: ______________________</td></tr></table>`,
  );
}
