import { Injectable, OnModuleInit } from '@nestjs/common';
import { can } from '../../common/context.js';
import { forbidden, notFound, rule } from '../../common/errors.js';
import { formatDate, formatDateTime, formatINR, istToday } from '../../common/india.js';
import { skipTake, toPage } from '../../common/pagination.dto.js';
import { CompanyService } from '../../core/company.service.js';
import { ReadPrismaService } from '../../core/prisma.service.js';
import { DocumentsService, XLSX_MIME } from '../documents/documents.service.js';
import { buildWorkbook } from '../masters/excel.js';
import { PdfService } from '../pdf/pdf.service.js';
import { esc, letterhead, page } from '../pdf/templates/base.js';
import { REPORTS, type MisColumn, type MisFilters, type MisReport } from './definitions.js';
import type { MisQuery } from './mis.dto.js';

const EXPORT_LIMIT = 200_000;
/** A PDF is for reading and printing; beyond this a browser renderer runs out of memory, so larger sets go to Excel. */
const PDF_EXPORT_LIMIT = 5_000;

function display(col: MisColumn, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (col.type === 'date') return formatDate(v as Date);
  if (col.type === 'datetime') return formatDateTime(v as Date);
  if (col.type === 'money') return formatINR(v as string);
  return String(v);
}

/** The reports module and the read layer behind it. Queries go to the read replica when configured. */
@Injectable()
export class MisService implements OnModuleInit {
  constructor(
    private readonly read: ReadPrismaService,
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
    private readonly company: CompanyService,
  ) {}

  onModuleInit() {
    for (const report of REPORTS) {
      this.documents.register(`mis:${report.key}`, {
        authorize: () => this.assertAccess(report),
        prepare: (p) => ({ ...p, customerVisible: can('customers.view') }),
        run: (p) => this.exportFile(report, p as MisFilters & { format?: string; customerVisible?: boolean }),
      });
    }
  }

  private assertAccess(report: MisReport) {
    if (!can(report.permission)) throw forbidden();
  }

  private columnsFor(report: MisReport, customerVisible: boolean) {
    return report.columns.filter((c) => customerVisible || !c.customer);
  }

  catalog() {
    const identity = can('customers.view');
    return REPORTS.filter((r) => can(r.permission)).map((r) => ({
      key: r.key,
      no: r.no,
      title: r.title,
      group: r.group,
      filters: r.filters,
      columns: this.columnsFor(r, identity).map((c) => ({ key: c.key, label: c.label, type: c.type ?? 'text' })),
    }));
  }

  private find(key: string) {
    const r = REPORTS.find((x) => x.key === key);
    if (!r) throw notFound('Report');
    return r;
  }

  private filters(q: MisQuery): MisFilters {
    return { from: q.from, to: q.to, customerId: q.customerId, departmentId: q.departmentId, technicianId: q.technicianId, status: q.status, urgent: q.urgent, stage: q.stage };
  }

  /** The total for a report under given filters, the same number the report's own pager shows. */
  async count(key: string, f: MisFilters, today = istToday()): Promise<number> {
    const r = this.find(key);
    return (await r.run({ db: this.read, f, today, skip: 0, take: 1 })).total;
  }

  async run(key: string, q: MisQuery) {
    const report = this.find(key);
    this.assertAccess(report);
    const identity = can('customers.view');
    const columns = this.columnsFor(report, identity);
    const { rows, total } = await report.run({ db: this.read, f: this.filters(q), today: istToday(), ...skipTake(q) });
    const keys = new Set(columns.map((c) => c.key));
    const data = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => keys.has(k))));
    return { key: report.key, title: report.title, columns: columns.map((c) => ({ key: c.key, label: c.label, type: c.type ?? 'text' })), ...toPage(data, total, q) };
  }

  private async exportFile(report: MisReport, p: MisFilters & { format?: string; customerVisible?: boolean }) {
    const columns = this.columnsFor(report, p.customerVisible === true);
    const asPdf = p.format === 'pdf';
    const { rows, total } = await report.run({ db: this.read, f: p, today: istToday(), skip: 0, take: asPdf ? PDF_EXPORT_LIMIT + 1 : EXPORT_LIMIT });
    const name = `${report.title}`.replace(/[^\w\- ]/g, '');
    if (asPdf && (rows.length > PDF_EXPORT_LIMIT || (total ?? 0) > PDF_EXPORT_LIMIT)) {
      throw rule('TOO_MANY_ROWS', `This report has more than ${PDF_EXPORT_LIMIT.toLocaleString('en-IN')} rows, which is too many for a PDF. Narrow the filters or export to Excel.`);
    }
    if (asPdf) {
      const company = this.company.snapshot();
      const filters = [p.from || p.to ? `Period: ${p.from ? formatDate(p.from) : 'start'} to ${p.to ? formatDate(p.to) : 'today'}` : null].filter(Boolean).join(' · ');
      const html = page(
        report.title,
        company,
        `${letterhead(company)}<h1>${esc(report.title)}</h1><p class="small center">${esc(filters)} · Generated ${esc(formatDateTime(new Date()))} · ${rows.length} rows</p>
      <table class="small"><thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td${c.type === 'money' || c.type === 'number' ? ' class="right"' : ''}>${esc(display(c, r[c.key]))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length}" class="center">No records.</td></tr>`}</tbody></table>`,
      );
      return { buffer: await this.pdf.render(html, { company, width: '297mm', height: '210mm' }), filename: `${name}.pdf`, mimeType: 'application/pdf' };
    }
    const buffer = await buildWorkbook([
      {
        name: report.title,
        columns: columns.map((c) => ({ header: c.label, key: c.key })),
        rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, c.type === 'money' ? Number(r[c.key] ?? 0) : c.type === 'number' ? r[c.key] : display(c, r[c.key])]))),
      },
    ]);
    return { buffer, filename: `${name}.xlsx`, mimeType: XLSX_MIME };
  }
}
