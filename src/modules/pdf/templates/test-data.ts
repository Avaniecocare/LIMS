import type { CompanySnapshot } from '../../../config/company.config.js';
import { formatDateTime } from '../../../common/india.js';
import { esc, letterhead, multiline, page } from './base.js';

export function testDataHtml(
  t: {
    testName: string; methodName: string | null; sampleNo: string; jobNo: string; sampleDescription: string; conductedByName: string | null; assignedToName: string | null; status: string;
    stages: { name: string; completedAt: Date | null; completedByName: string | null }[];
    results: { name: string; unit: string | null; value: unknown; working: string | null }[];
    remarks: string | null; observations: string | null; notes: string | null;
  },
  company: CompanySnapshot,
): string {
  return page(`Test data ${t.sampleNo}`, company, `${letterhead(company)}<h1>Test Data Sheet</h1>
  <table class="plain"><tr><td><b>Sample:</b> ${esc(t.sampleNo)}</td><td><b>Job:</b> ${esc(t.jobNo)}</td></tr><tr><td><b>Test:</b> ${esc(t.testName)}</td><td><b>Method:</b> ${esc(t.methodName)}</td></tr>
  <tr><td><b>Description:</b> ${esc(t.sampleDescription)}</td><td><b>Test conducted by:</b> ${esc(t.conductedByName ?? t.assignedToName)}</td></tr></table>
  <h2>Stages</h2><table><thead><tr><th>Stage</th><th>Completed</th><th>By</th></tr></thead><tbody>${t.stages.map((s) => `<tr><td>${esc(s.name)}</td><td>${formatDateTime(s.completedAt)}</td><td>${esc(s.completedByName)}</td></tr>`).join('')}</tbody></table>
  <h2>Results</h2><table><thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Working</th></tr></thead><tbody>${t.results.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.value)}</td><td>${esc(r.unit)}</td><td class="small">${esc(r.working)}</td></tr>`).join('')}</tbody></table>
  ${t.observations ? `<h2>Observations</h2><p>${multiline(t.observations)}</p>` : ''}${t.remarks ? `<h2>Remarks</h2><p>${multiline(t.remarks)}</p>` : ''}${t.notes ? `<h2>Notes</h2><p>${multiline(t.notes)}</p>` : ''}`);
}
