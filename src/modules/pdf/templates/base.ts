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

/** Full-page documents carry the logo as a faint watermark. Labels opt out so their QR code stays easy to scan. */
export function page(title: string, company: CompanySnapshot, body: string, options: { watermark?: boolean } = {}): string {
  const primary = company.branding.primaryColor;
  const accent = company.branding.accentColor;
  const logo = company.branding.logoDataUri;
  // A fixed element repeats on every printed page in Chromium; behind the content, it shows through unshaded cells.
  const watermark = options.watermark !== false && logo ? `<div class="watermark" aria-hidden="true"><img src="${logo}" alt=""></div>` : '';
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* Chromium clips whatever sits exactly on the right page margin, which removed the right border of tables and boxes. */
body{margin:0;padding:0 1px;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;line-height:1.4;color:#111827}
h1{font-size:14px;font-weight:700;margin:8px 0 6px;padding:6px 8px;text-align:center;text-transform:uppercase;letter-spacing:1.5px;color:#fff;background:${primary};border-bottom:2px solid ${accent}}
h2{font-size:11.5px;margin:12px 0 4px;color:${primary}}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #9ca3af;padding:3.5px 5px;vertical-align:top;text-align:left}
th{background:#f3f4f6;font-weight:600}
th.right{white-space:nowrap}
thead{display:table-header-group}
tr{page-break-inside:avoid}
.right{text-align:right}.center{text-align:center}.muted{color:#4b5563}.small{font-size:9px}.bold{font-weight:700}
.plain,.plain td,.plain th{border:0;padding:1.5px 4px 1.5px 0}
.letterhead{display:flex;align-items:stretch;gap:12px;padding-bottom:8px;border-bottom:3px solid ${primary}}
/* A plain strip, not a box-shadow: Chromium's PDF output draws a hairline along the edge of a shadowed box. */
.letterhead-rule{height:2px;background:${accent};margin-bottom:6px}
.letterhead img{height:58px;width:auto;object-fit:contain;align-self:center}
.letterhead .brand{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}
.letterhead .name{font-size:17px;font-weight:700;letter-spacing:.4px;color:${primary}}
.letterhead .address{margin-top:3px;font-size:9px;color:#4b5563;max-width:95%}
.letterhead .contact{flex:0 0 auto;padding-left:10px;border-left:2px solid ${accent};display:flex;flex-direction:column;justify-content:center;font-size:9px;line-height:1.55;text-align:left}
.letterhead .contact b{display:inline-block;min-width:36px;color:${primary}}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.box{border:1px solid #9ca3af;padding:6px}
.totals{width:46%;margin-left:auto;margin-top:6px}
.page-break{page-break-before:always}
.keep{page-break-inside:avoid}
.terms{white-space:pre-wrap;font-size:9.5px}
.watermark{position:fixed;inset:0;z-index:-1;display:flex;align-items:center;justify-content:center;pointer-events:none}
.watermark img{width:60%;max-height:60%;object-fit:contain;opacity:.07}
</style></head><body>${watermark}${body}</body></html>`;
}

export function letterhead(c: CompanySnapshot): string {
  const logo = c.branding.logoDataUri ? `<img src="${c.branding.logoDataUri}" alt="">` : '';
  const line = (label: string, value: string | null | undefined) => (value ? `<div><b>${label}</b> ${esc(value)}</div>` : '');
  const website = c.website?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `<div class="letterhead">${logo}<div class="brand"><div class="name">${esc(c.legalName)}</div><div class="address">${esc(c.labAddress)}</div></div>
  <div class="contact">${line('Phone', c.phone)}${line('Email', c.email)}${line('Web', website)}${line('GSTIN', c.gstin)}${line('PAN', c.pan)}${line('CIN', c.cin)}</div></div><div class="letterhead-rule"></div>`;
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
