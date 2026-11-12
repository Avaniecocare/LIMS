import type { CompanySnapshot } from '../../../config/company.config.js';
import { formatDate, formatDateTime } from '../../../common/india.js';
import { esc, letterhead, multiline, page } from './base.js';

export interface JobDocument {
  jobNo: string;
  receivedAt: Date;
  urgent: boolean;
  letterRef: string | null;
  letterDate: Date | null;
  materialSpec: string | null;
  poNumber: string | null;
  poDate: Date | null;
  receiptMode: string | null;
  reportIssueDetails: string | null;
  reportIssueAddress: string | null;
  kindAttention: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  customerName: string;
  crn: string;
  receivedBy: string | null;
  samples: { sampleNo: string; description: string; condition: string | null; quantity: string | null; size: string | null; returnable: boolean; attributes: { label: string; value: string }[]; tests: string[] }[];
  deviations: { sampleNo: string | null; typeLabel: string; remark: string | null }[];
}

const kv = (rows: [string, unknown][]) => `<table class="plain">${rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<tr><td class="bold" style="width:34%">${esc(k)}</td><td>${multiline(v)}</td></tr>`).join('')}</table>`;

function jobHeader(j: JobDocument): string {
  return `<div class="grid"><div class="box">${kv([
    ['Job no.', j.jobNo],
    ['Received', formatDateTime(j.receivedAt)],
    ['Priority', j.urgent ? 'URGENT' : 'Normal'],
    ['Customer', j.customerName],
    ['Customer no.', j.crn],
    ['Kind attention', j.kindAttention],
    ['Email', j.contactEmail],
    ['Phone', j.contactPhone],
  ])}</div><div class="box">${kv([
    ['Letter / challan', j.letterRef],
    ['Letter date', j.letterDate ? formatDate(j.letterDate) : null],
    ['Material specification', j.materialSpec],
    ['PO no.', j.poNumber],
    ['PO date', j.poDate ? formatDate(j.poDate) : null],
    ['Receipt mode', j.receiptMode],
    ['Report issue', j.reportIssueDetails],
    ['Report address', j.reportIssueAddress],
  ])}</div></div>`;
}

function sampleTable(j: JobDocument): string {
  const rows = j.samples
    .map(
      (s, i) => `<tr><td class="center">${i + 1}</td><td>${esc(s.sampleNo)}</td><td>${esc(s.description)}${s.attributes.length ? `<div class="small muted">${s.attributes.map((a) => `${esc(a.label)}: ${esc(a.value)}`).join('; ')}</div>` : ''}</td>
      <td>${esc(s.condition)}</td><td>${esc(s.quantity)}</td><td>${esc(s.size)}</td><td>${s.returnable ? 'Yes' : 'No'}</td><td>${s.tests.map(esc).join('<br>')}</td></tr>`,
    )
    .join('');
  return `<h2>Samples</h2><table><thead><tr><th class="center">S.No</th><th>Sample no.</th><th>Description</th><th>Condition</th><th>Qty</th><th>Size</th><th>Returnable</th><th>Tests requested</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function deviations(j: JobDocument): string {
  if (!j.deviations.length) return '<p class="small">Deviations: none recorded.</p>';
  return `<h2>Deviations</h2><table><thead><tr><th>Sample</th><th>Deviation</th><th>Remark</th></tr></thead><tbody>${j.deviations.map((d) => `<tr><td>${esc(d.sampleNo ?? 'All')}</td><td>${esc(d.typeLabel)}</td><td>${esc(d.remark)}</td></tr>`).join('')}</tbody></table>`;
}

export function srfHtml(j: JobDocument, company: CompanySnapshot): string {
  return page(`SRF ${j.jobNo}`, company, `${letterhead(company)}<h1>Sample Request Form</h1>${jobHeader(j)}${sampleTable(j)}${deviations(j)}
  <table class="plain" style="margin-top:28px"><tr><td>Received by: ${esc(j.receivedBy)}</td><td class="right">Customer representative: ______________________</td></tr></table>`);
}

export interface AckPhoto {
  dataUri: string;
  caption: string;
}

/** Photos of the samples as received, two to a row; optional, shown only when some were chosen. */
function ackPhotos(photos: AckPhoto[]): string {
  if (!photos.length) return '';
  return `<h2>Photographs of samples as received</h2><div style="display:flex;flex-wrap:wrap;gap:6mm">${photos
    .map((p, i) => `<figure class="keep" style="margin:0;width:85mm"><img src="${p.dataUri}" alt="" style="width:85mm;height:64mm;object-fit:contain;display:block;border:0.2mm solid #ccc"><figcaption class="small muted">Photo ${i + 1}${p.caption ? `: ${esc(p.caption)}` : ''}</figcaption></figure>`)
    .join('')}</div>`;
}

export function acknowledgementHtml(j: JobDocument, company: CompanySnapshot, photos: AckPhoto[] = []): string {
  return page(`Acknowledgement ${j.jobNo}`, company, `${letterhead(company)}<h1>Sample Acknowledgement</h1>
  <p>Dear ${esc(j.kindAttention ?? 'Sir/Madam')},</p><p>We have received the samples listed below under job <strong>${esc(j.jobNo)}</strong> on ${formatDateTime(j.receivedAt)}. Please quote this number in all correspondence.</p>
  ${sampleTable(j)}${deviations(j)}${ackPhotos(photos)}<p style="margin-top:20px">For <strong>${esc(company.legalName)}</strong></p>`);
}

export interface LabelDoc {
  sampleNo: string;
  jobNo: string;
  description: string;
  urgent: boolean;
  returnable: boolean;
  receivedAt: Date;
  qrDataUri: string;
}

/** One label per page at 70 × 40 mm, for label printers. No customer identity on the label. */
export function labelsHtml(labels: LabelDoc[], company: CompanySnapshot): string {
  const body = labels
    .map(
      (l, i) => `<div style="display:flex;gap:6px;height:36mm;${i ? 'page-break-before:always' : ''}"><img src="${l.qrDataUri}" alt="" style="width:30mm;height:30mm">
      <div style="font-size:9px;line-height:1.3;overflow:hidden"><div class="bold" style="font-size:10px">${esc(l.sampleNo)}</div><div>Job ${esc(l.jobNo)}</div><div>${esc(l.description.slice(0, 60))}</div><div>${formatDate(l.receivedAt)}</div>
      <div class="bold">${l.urgent ? 'URGENT ' : ''}${l.returnable ? 'RETURNABLE' : ''}</div></div></div>`,
    )
    .join('');
  return page('Sample labels', company, body, { watermark: false });
}

export interface JobCardTest {
  testName: string;
  methodName: string | null;
  sampleNo: string;
  sampleDescription: string;
  dueDate: Date | null;
  urgent: boolean;
  assignee: string | null;
  instrument: string | null;
  analysisMode: string | null;
  officeInstructions: string | null;
  technicalData: string | null;
  parameters: string[];
  stages: string[];
}

/** Job card for the bench. Shows codes only when impartiality is on: no customer, no prices. */
export function jobCardHtml(card: { jobNo: string; customerName: string | null; tests: JobCardTest[] }, company: CompanySnapshot): string {
  const rows = card.tests
    .map(
      (t) => `<div class="box keep" style="margin-top:8px"><table class="plain"><tr><td class="bold" style="width:50%">${esc(t.testName)}</td><td class="right">${t.urgent ? '<span class="bold">URGENT</span> · ' : ''}Due ${formatDate(t.dueDate)}</td></tr>
      <tr><td>Sample: ${esc(t.sampleNo)} — ${esc(t.sampleDescription)}</td><td class="right">Method: ${esc(t.methodName)}</td></tr>
      <tr><td>Analyst: ${esc(t.assignee)}</td><td class="right">Instrument: ${esc(t.instrument)}${t.analysisMode ? ` · ${esc(t.analysisMode)}` : ''}</td></tr></table>
      ${t.officeInstructions ? `<p class="small"><span class="bold">Office instructions:</span> ${multiline(t.officeInstructions)}</p>` : ''}
      ${t.technicalData ? `<p class="small"><span class="bold">Technical data:</span> ${multiline(t.technicalData)}</p>` : ''}
      <p class="small"><span class="bold">Parameters:</span> ${t.parameters.map(esc).join(', ')}</p>
      <table class="small"><thead><tr>${t.stages.map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead><tbody><tr style="height:26px">${t.stages.map(() => '<td></td>').join('')}</tr></tbody></table></div>`,
    )
    .join('');
  return page(`Job card ${card.jobNo}`, company, `${letterhead(company)}<h1>Job Card</h1><table class="plain"><tr><td><span class="bold">Job no.:</span> ${esc(card.jobNo)}</td>${card.customerName ? `<td class="right"><span class="bold">Customer:</span> ${esc(card.customerName)}</td>` : ''}</tr></table>${rows}`);
}
