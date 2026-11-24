import { Injectable, OnModuleInit } from '@nestjs/common';
import { formatDateTime } from '../../common/india.js';
import { rule } from '../../common/errors.js';
import { PrismaService } from '../../core/prisma.service.js';
import { auditWhere, type AuditFilter } from '../admin/audit-filter.js';
import { DocumentsService, requirePermission, XLSX_MIME } from '../documents/documents.service.js';
import { buildWorkbook } from '../masters/excel.js';

/** A workbook is built in memory. Longer periods are exported in parts, or with the company's whole data. */
export const AUDIT_EXPORT_LIMIT = 20_000;
/** Excel refuses longer cells. */
const CELL_LIMIT = 32_000;

const text = (v: unknown) => {
  const s = v === null || v === undefined ? '' : JSON.stringify(v);
  return s.length > CELL_LIMIT ? `${s.slice(0, CELL_LIMIT)}… (cut short)` : s;
};

@Injectable()
export class AuditExport implements OnModuleInit {
  constructor(
    private readonly documents: DocumentsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.documents.register('audit-export', {
      sensitive: true,
      authorize: requirePermission('admin.audit'),
      prepare: (params) => ({ ...filterOf(params) }),
      run: async (params) => {
        const where = auditWhere(params as AuditFilter);
        const total = await this.prisma.auditLog.count({ where });
        if (total > AUDIT_EXPORT_LIMIT)
          throw rule('TOO_MANY_ROWS', `That is ${total.toLocaleString('en-IN')} entries; an export holds ${AUDIT_EXPORT_LIMIT.toLocaleString('en-IN')}. Choose a shorter period.`);
        const rows = await this.prisma.auditLog.findMany({ where, orderBy: { id: 'asc' } });
        const buffer = await buildWorkbook([
          {
            name: 'Audit log',
            columns: [
              { header: 'No.', key: 'no' },
              { header: 'When (India)', key: 'at', width: 22 },
              { header: 'Who', key: 'who', width: 24 },
              { header: 'Address', key: 'ip', width: 18 },
              { header: 'What', key: 'action', width: 28 },
              { header: 'Record', key: 'entity', width: 20 },
              { header: 'Record ID', key: 'entityId', width: 38 },
              { header: 'Reason', key: 'reason', width: 40 },
              { header: 'Before', key: 'before', width: 60 },
              { header: 'After', key: 'after', width: 60 },
              { header: 'Request ID', key: 'requestId', width: 38 },
            ],
            rows: rows.map((r) => ({
              no: r.id.toString(),
              at: formatDateTime(r.at),
              who: r.userName ?? 'System',
              ip: r.ip,
              action: r.action,
              entity: r.entity,
              entityId: r.entityId,
              reason: r.reason,
              before: text(r.before),
              after: text(r.after),
              requestId: r.requestId,
            })),
          },
        ]);
        return { buffer, filename: 'Audit log.xlsx', mimeType: XLSX_MIME, category: 'exports' };
      },
    });
  }
}

/** Only known filters, only text, only days: the rest of what a browser sends is ignored. */
function filterOf(params: Record<string, unknown>): AuditFilter {
  const str = (k: string) => (typeof params[k] === 'string' && params[k] !== '' ? (params[k] as string).slice(0, 200) : undefined);
  const day = (k: string) => (/^\d{4}-\d{2}-\d{2}/.test(str(k) ?? '') && !Number.isNaN(Date.parse(str(k)!.slice(0, 10))) ? str(k)!.slice(0, 10) : undefined);
  return { entity: str('entity'), entityId: str('entityId'), action: str('action'), userId: str('userId'), q: str('q'), from: day('from'), to: day('to') };
}
