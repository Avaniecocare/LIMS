import type { CompanySnapshot } from '../../../config/company.config.js';
import { formatDate, formatDateTime } from '../../../common/india.js';
import { esc, letterhead, multiline, page } from './base.js';

export interface ReportParameterRow {
  name: string;
  value: string | null;
  unit: string | null;
  limits: { spec: string; role: string; min: string | null; max: string | null; text: string | null }[];
  passPrimary: boolean | null;
  passDual: boolean | null;
  accredited: boolean;
}

export interface ReportTest {
  sampleTestId: string;
  testName: string;
  methodName: string | null;
  conductedByName: string | null;
  remarks: string | null;
  observations: string | null;
  parameters: ReportParameterRow[];
  /** instrument used, as "code name", for figure and annexure labels */
  instrument?: string | null;
  images: { fileId: string; widthMm: number; heightMm: number; caption: string | null; recordedAt?: string; dataUri?: string | null }[];
  /** instrument software reports (PDF), printed as annexure pages after the report body; fingerprinted when signed */
  annexes?: ReportAnnex[];
}

export interface ReportAnnex {
  fileId: string;
  title: string;
  pages: number;
  sha256: string;
  recordedAt: string;
}

/** Annexures in report order (A, B, C… across tests), so the body and the appended pages use the same letters. */
export function reportAnnexes(content: { tests: ReportTest[] }): (ReportAnnex & { letter: string; testName: string; instrument: string | null })[] {
  return content.tests.flatMap((t) => (t.annexes ?? []).map((a) => ({ ...a, testName: t.testName, instrument: t.instrument ?? null }))).map((a, i) => ({ ...a, letter: annexLetter(i) }));
}
const annexLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : `${annexLetter(Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);

export interface ReportContent {
  sampleNo: string;
  jobNo: string;
  customer: { name: string; crn: string; address: string | null; kindAttention: string | null; email: string | null; phone: string | null; gstin: string | null };
  customerReference: string | null;
  sampleDescription: string;
  sampleCondition: string | null;
  sampleQuantity: string | null;
  sampleSize: string | null;
  bookingDate: string | null;
  testStartDate: string | null;
  testCompletionDate: string | null;
  sampleDrawnByLab: boolean;
  specificationNames: string[];
  deviations: { typeLabel: string; remark: string | null }[];
  tests: ReportTest[];
  /** corrections made on the draft */
  reportRemarks: string | null;
  /** photographs of the sample chosen on the draft, printed in their own section; absent on older reports */
  samplePhotos?: ReportPhoto[];
}

export interface ReportPhoto {
  fileId: string;
  widthMm: number;
  heightMm: number;
  caption: string | null;
  dataUri?: string | null;
}

export interface ReportFormat {
  formatNo: string;
  issueNo: string;
  issueDate: string;
  revisionNo: string;
  revisionDate: string;
  samplingStatement: string;
}

export interface ReportRenderInput {
  reportNo: string;
  revisionNo: number;
  replacesLabel: string | null;
  revisionReason: string | null;
  ulrNumber: string | null;
  issueDate: Date | string | null;
  content: ReportContent;
  format: ReportFormat;
  company: CompanySnapshot;
  terms: string | null;
  reviewedByName: string | null;
  draft: boolean;
  signature: { name: string; designation: string | null; signedAt: Date | string; contentSha256: string; imageDataUri: string | null } | null;
  /** set once approved: the public verification link and its QR code */
  verification?: { url: string; qrDataUri: string } | null;
}

const limitText = (l: { min: string | null; max: string | null; text: string | null }) => {
  if (l.text) return l.text;
  if (l.min !== null && l.max !== null) return `${trim(l.min)} – ${trim(l.max)}`;
  if (l.min !== null) return `Min ${trim(l.min)}`;
  if (l.max !== null) return `Max ${trim(l.max)}`;
  return '';
};

const trim = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);

function resultTable(rows: { test: ReportTest; p: ReportParameterRow }[], dual: boolean, grades: string[]) {
  let sno = 0;
  const body = rows
    .map(({ test, p }) => {
      sno++;
      const primary = p.limits.find((l) => l.role === 'primary');
      const second = p.limits.find((l) => l.role === 'dual');
      return `<tr><td class="center">${sno}</td><td>${esc(p.name)}</td><td class="bold">${esc(p.value)}${p.unit ? ` ${esc(p.unit)}` : ''}</td><td>${esc(test.methodName)}</td>${grades.length ? `<td>${primary ? esc(limitText(primary)) : '—'}</td>` : ''}${dual ? `<td>${second ? esc(limitText(second)) : '—'}</td>` : ''}</tr>`;
    })
    .join('');
  return `<table><thead><tr><th class="center" style="width:7%">S.No</th><th>Test Parameter</th><th>Observed Result</th><th>Test Method</th>${grades.length ? `<th>Limits${grades[0] ? ` (${esc(grades[0])})` : ''}</th>` : ''}${dual ? `<th>Limits (${esc(grades[1])})</th>` : ''}</tr></thead><tbody>${body}</tbody></table>`;
}

/** QR and link to the public verification page; drafts say where it will appear. */
function verifyBlock(r: ReportRenderInput): string {
  if (!r.verification) return r.draft ? '<p class="small muted">A QR code for online verification is added when the report is approved.</p>' : '';
  return `<table class="plain keep" style="margin-top:8px;width:auto"><tr>
  <td style="width:25mm;padding-right:8px"><img src="${r.verification.qrDataUri}" alt="" style="width:23mm;height:23mm;display:block"></td>
  <td style="vertical-align:middle"><div class="bold">Verify this report</div><div class="small">Scan the QR code with any phone camera, or open this link to check that the report is genuine and current:</div><div class="small" style="word-break:break-all">${esc(r.verification.url)}</div></td></tr></table>`;
}

export function reportHtml(r: ReportRenderInput): string {
  const c = r.content;
  const co = r.company;
  const nabl = co.accreditation.nablMode;
  const all = c.tests.flatMap((test) => test.parameters.map((p) => ({ test, p })));
  const inScope = nabl ? all.filter((x) => x.p.accredited) : all;
  const outOfScope = nabl ? all.filter((x) => !x.p.accredited) : [];
  const dual = c.specificationNames.length > 1;

  const kv = (rows: [string, unknown][]) => rows.map(([k, v]) => `<tr><th style="width:24%">${esc(k)}</th><td>${multiline(v)}</td></tr>`).join('');

  const pageOne = `${letterhead(co)}
  <table class="small" style="margin-bottom:6px"><tr><th>Format no.</th><td>${esc(r.format.formatNo)}</td><th>Issue no. and date</th><td>${esc(r.format.issueNo)}${r.format.issueDate ? `, ${esc(r.format.issueDate)}` : ''}</td><th>Revision no. and date</th><td>${esc(r.format.revisionNo)}${r.format.revisionDate ? `, ${esc(r.format.revisionDate)}` : ''}</td></tr></table>
  <h1>Test Report${r.draft ? ' — DRAFT, NOT FOR ISSUE' : ''}</h1>
  ${r.revisionNo > 0 ? `<p class="center bold">Revision ${r.revisionNo}${r.replacesLabel ? `. This report replaces ${esc(r.replacesLabel)}` : ''}${r.revisionReason ? `. Reason: ${esc(r.revisionReason)}` : ''}</p>` : ''}
  <table style="margin-top:6px"><tbody>
  ${kv([
    ['Report issued to', `${c.customer.name}${c.customer.address ? `\n${c.customer.address}` : ''}`],
    ['Report no.', `${r.reportNo}${r.ulrNumber ? `\nULR: ${r.ulrNumber}` : ''}`],
    ['Issue date', formatDate(r.issueDate as string | null)],
    ['Booking / receipt date', formatDate(c.bookingDate)],
    ['Test start date', formatDate(c.testStartDate)],
    ['Test completion date', formatDate(c.testCompletionDate)],
    ['Customer no.', c.customer.crn],
    ['Sample no.', c.sampleNo],
    ['Sample description', c.sampleDescription],
    ['Customer reference', c.customerReference],
    ['Kind attention', c.customer.kindAttention],
    ['Email', c.customer.email],
    ['Contact no.', c.customer.phone],
    ['Sample condition', c.sampleCondition],
    ['Sample quantity and size', [c.sampleQuantity, c.sampleSize].filter(Boolean).join(', ')],
    ...(c.specificationNames.length ? ([['Specification', c.specificationNames.join(' and ')]] as [string, unknown][]) : []),
  ])}
  </tbody></table>
  ${c.sampleDrawnByLab ? '' : `<p class="bold">${esc(r.format.samplingStatement)}</p>`}
  ${c.deviations.length ? `<p class="small"><span class="bold">Deviations noted at receipt:</span> ${c.deviations.map((d) => `${esc(d.typeLabel)}${d.remark ? ` (${esc(d.remark)})` : ''}`).join('; ')}</p>` : ''}
  ${verifyBlock(r)}`;

  const remarks = c.tests.filter((t) => t.remarks || t.observations);
  const photos = (c.samplePhotos ?? []).filter((i) => i.dataUri);
  const images = c.tests.flatMap((t) => t.images.map((i) => ({ ...i, testName: t.testName, instrument: t.instrument ?? null }))).filter((i) => i.dataUri);
  const annexes = reportAnnexes(c);
  const annexPages = annexes.reduce((s, a) => s + a.pages, 0);
  const signed = r.signature
    ? `<div>${r.signature.imageDataUri ? `<img src="${r.signature.imageDataUri}" alt="" style="height:36px;display:block">` : ''}<div class="bold">${esc(r.signature.name)}</div>${r.signature.designation && r.signature.designation !== 'Authorised Signatory' ? `<div>${esc(r.signature.designation)}</div>` : ''}<div class="small">Authorised Signatory</div></div>`
    : '<div class="muted">Not yet approved</div>';
  // Wording rule: this product applies no certificate, so it must never claim "Digitally Signed".
  const approval = r.signature
    ? `<p class="small">Electronically approved by ${esc(r.signature.name)} on ${formatDateTime(r.signature.signedAt)}. Report hash (SHA-256): <span style="word-break:break-all">${esc(r.signature.contentSha256)}</span></p>`
    : '';

  const results = `<div class="page-break"></div><h2>Results</h2>
  ${nabl ? `<h2>Tests within the scope of accreditation${co.accreditation.nablCertificateNo ? ` (certificate ${esc(co.accreditation.nablCertificateNo)})` : ''}</h2>` : ''}
  ${inScope.length ? resultTable(inScope, dual, c.specificationNames) : nabl ? '<p>None.</p>' : ''}
  ${outOfScope.length ? `<h2>Tests outside the scope of accreditation</h2>${resultTable(outOfScope, dual, c.specificationNames)}` : ''}
  ${remarks.length ? `<h2>Remarks</h2>${remarks.map((t) => `<p><span class="bold">${esc(t.testName)}:</span> ${multiline(t.observations)} ${multiline(t.remarks)}</p>`).join('')}` : ''}
  ${c.reportRemarks ? `<h2>Report remarks</h2><p>${multiline(c.reportRemarks)}</p>` : ''}
  ${photos.length ? `<h2>Sample photographs</h2><div style="display:flex;flex-wrap:wrap;gap:6mm;align-items:flex-start">${photos.map((i, n) => `<figure class="keep" style="margin:0;width:${i.widthMm}mm"><img src="${i.dataUri}" alt="" style="width:${i.widthMm}mm;height:${i.heightMm}mm;object-fit:contain;display:block;border:0.2mm solid #ccc"><figcaption class="small muted">Photo ${n + 1}${i.caption ? `: ${esc(i.caption)}` : ''}</figcaption></figure>`).join('')}</div>` : ''}
  ${
    images.length
      ? `<h2>Figures</h2>${images
          .map(
            // Each figure says what it shows and where it came from: sample, test, instrument and when it was recorded.
            (i, n) =>
              `<figure class="keep" style="margin:8px 0"><img src="${i.dataUri}" alt="" style="width:${i.widthMm}mm;height:${i.heightMm}mm;object-fit:contain;display:block"><figcaption class="small"><span class="bold">Figure ${n + 1}</span> · ${esc(i.testName)}${i.caption ? `: ${esc(i.caption)}` : ''}<br><span class="muted">Sample ${esc(c.sampleNo)}${i.instrument ? ` · ${esc(i.instrument)}` : ''}${i.recordedAt ? ` · recorded ${formatDate(i.recordedAt)}` : ''}</span></figcaption></figure>`,
          )
          .join('')}`
      : ''
  }
  ${
    annexes.length
      ? `<h2>Annexures</h2><p class="small">The instrument reports below form part of this report. They follow the report body (${annexPages} page${annexPages === 1 ? '' : 's'}), and each annexure page carries this report's number and page count.</p>
  <table class="keep"><thead><tr><th>Annexure</th><th>Test</th><th>Instrument report</th><th>Instrument</th><th>Pages</th></tr></thead><tbody>${annexes
    .map((a) => `<tr><td class="bold">${a.letter}</td><td>${esc(a.testName)}</td><td>${esc(a.title)}</td><td>${a.instrument ? esc(a.instrument) : '—'}</td><td>${a.pages}</td></tr>`)
    .join('')}</tbody></table>`
      : ''
  }
  <table class="plain keep" style="margin-top:26px"><tr><td style="width:50%"><div class="bold">Reviewed by</div>${r.reviewedByName ? esc(r.reviewedByName) : '<span class="muted">Not yet reviewed</span>'}</td><td>${signed}</td></tr></table>
  ${approval}`;

  const terms = r.terms ? `<div class="page-break"></div><h2>General Terms &amp; Conditions</h2><div class="terms">${esc(r.terms)}</div>` : '';
  return page(
    `Test Report ${r.reportNo}`,
    co,
    `${pageOne}${results}${terms}<p class="center bold" style="margin-top:14px">${annexes.length ? `Annexure${annexes.length === 1 ? '' : 's'} ${annexes.length === 1 ? annexes[0].letter : `${annexes[0].letter}–${annexes[annexes.length - 1].letter}`} follow${annexes.length === 1 ? 's' : ''}` : 'End of Report'}</p>`,
  );
}
