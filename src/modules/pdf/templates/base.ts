import type { CompanySnapshot } from '../../../config/company.config.js';

export const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Multi-line user text, escaped, keeping its line breaks. */
export const multiline = (v: unknown): string => esc(v).replace(/\n/g, '<br>');

export function page(title: string, company: CompanySnapshot, body: string): string {
  const primary = company.branding.primaryColor;
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;line-height:1.4;color:#111827}
h1{font-size:15px;margin:0;text-align:center;color:${primary};letter-spacing:.3px}
h2{font-size:11.5px;margin:12px 0 4px;color:${primary}}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #9ca3af;padding:3.5px 5px;vertical-align:top;text-align:left}
th{background:#f3f4f6;font-weight:600}
thead{display:table-header-group}
tr{page-break-inside:avoid}
.right{text-align:right}.center{text-align:center}.muted{color:#4b5563}.small{font-size:9px}.bold{font-weight:700}
.plain,.plain td,.plain th{border:0;padding:1.5px 4px 1.5px 0}
.letterhead{display:flex;align-items:center;gap:12px;border-bottom:2px solid ${primary};padding-bottom:7px;margin-bottom:8px}
.letterhead img{height:46px;width:auto;object-fit:contain}
.letterhead .name{font-size:15px;font-weight:700;color:${primary}}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.box{border:1px solid #9ca3af;padding:6px}
.totals{width:46%;margin-left:auto;margin-top:6px}
.page-break{page-break-before:always}
.keep{page-break-inside:avoid}
.terms{white-space:pre-wrap;font-size:9.5px}
</style></head><body>${body}</body></html>`;
}

export function letterhead(c: CompanySnapshot): string {
  const logo = c.branding.logoDataUri ? `<img src="${c.branding.logoDataUri}" alt="">` : '';
  return `<div class="letterhead">${logo}<div><div class="name">${esc(c.legalName)}</div>
  <div class="small">${esc(c.labAddress)}<br>${esc(c.phone)} · ${esc(c.email)}${c.website ? ` · ${esc(c.website)}` : ''}<br>GSTIN: ${esc(c.gstin)} · PAN: ${esc(c.pan)}${c.cin ? ` · CIN: ${esc(c.cin)}` : ''}</div></div></div>`;
}

export function bankBlock(c: CompanySnapshot): string {
  const b = c.bank;
  return `<table class="plain small"><tr><td class="bold" colspan="2">Bank details</td></tr>
  <tr><td>Account name</td><td>${esc(b.accountName)}</td></tr>
  <tr><td>Account no.</td><td>${esc(b.accountNumber)}</td></tr>
  <tr><td>Bank, branch</td><td>${esc(b.bankName)}, ${esc(b.branch)}</td></tr>
  <tr><td>IFSC</td><td>${esc(b.ifsc)}</td></tr>
  ${b.swift ? `<tr><td>SWIFT</td><td>${esc(b.swift)}</td></tr>` : ''}</table>`;
}

export interface CustomerSnapshot {
  crn: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  stateName: string;
  stateCode: string;
  billingAddress: string | null;
  reportAddress: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export function customerBlock(c: CustomerSnapshot, label = 'To'): string {
  return `<div class="box"><div class="bold">${esc(label)}</div><div class="bold">${esc(c.name)}</div>
  ${c.billingAddress ? `<div>${multiline(c.billingAddress)}</div>` : ''}
  <div>State: ${esc(c.stateName)} (${esc(c.stateCode)})</div>
  ${c.gstin ? `<div>GSTIN: ${esc(c.gstin)}</div>` : ''}
  <div>Customer no.: ${esc(c.crn)}</div>
  ${c.contactName ? `<div>Attention: ${esc(c.contactName)}</div>` : ''}</div>`;
}

export function taxTotalsTable(t: { subtotal: unknown; discountAmount: unknown; taxableAmount: unknown; gstRate: unknown; cgst: unknown; sgst: unknown; igst: unknown; roundOff: unknown; grandTotal: unknown }, inr: (v: never) => string, subtotalLabel = 'Subtotal', totalLabel = 'Grand total (₹)'): string {
  const fmt = (v: unknown) => inr(String(v) as never);
  const rate = Number(t.gstRate);
  const row = (label: string, v: unknown, bold = false) => `<tr class="${bold ? 'bold' : ''}"><td>${esc(label)}</td><td class="right">${fmt(v)}</td></tr>`;
  return `<table class="totals">${row(subtotalLabel, t.subtotal)}
  ${Number(t.discountAmount) ? row('Discount', t.discountAmount) : ''}
  ${Number(t.discountAmount) ? row('Taxable amount', t.taxableAmount) : ''}
  ${Number(t.igst) ? row(`IGST @ ${rate}%`, t.igst) : `${row(`CGST @ ${rate / 2}%`, t.cgst)}${row(`SGST @ ${rate / 2}%`, t.sgst)}`}
  ${Number(t.roundOff) ? row('Round off', t.roundOff) : ''}
  ${row(totalLabel, t.grandTotal, true)}</table>`;
}
