import { Injectable } from '@nestjs/common';
import { badRequest, conflict } from '../common/errors.js';
import { AuditService } from './audit.service.js';
import { numberFormatProblem } from './number-format.js';
import { Prisma, PrismaService, type Tx } from './prisma.service.js';

type Validator = (v: unknown) => boolean;
const isBool: Validator = (v) => typeof v === 'boolean';
const isStr: Validator = (v) => typeof v === 'string';
const isNonNeg: Validator = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isIntArr =
  (min: number, max: number): Validator =>
  (v) =>
    Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= min && n <= max);

/** Every lab-adjustable setting, with its default and validator. Adding a setting here exposes it. */
export const SETTINGS = {
  'tax.gstRate': { default: 18, validate: (v: unknown) => isNonNeg(v) && (v as number) <= 100, label: 'GST rate (%)', group: 'Tax' },
  'numbering.formats': {
    default: {
      CUSTOMER: 'CRN-{SEQ:5}',
      ORDER: '{PREFIX}/ORD/{FY}/{SEQ:5}',
      QUOTATION: '{PREFIX}/QT/{FY}/{SEQ:5}',
      JOB: '{PREFIX}/JOB/{FY}/{SEQ:5}',
      SAMPLE: '{PREFIX}/S/{FY}/{SEQ:6}',
      PLAN: '{PREFIX}/PL/{FY}/{SEQ:5}',
      REPORT: '{PREFIX}/TR/{FY}/{SEQ:6}',
      DISPATCH: '{PREFIX}/DC/{FY}/{SEQ:5}',
      INVOICE: '{PREFIX}/INV/{FY}/{SEQ:5}',
      CREDIT_NOTE: '{PREFIX}/CN/{FY}/{SEQ:5}',
      PAYMENT: '{PREFIX}/RCP/{FY}/{SEQ:5}',
      ULR: '{SEQ:8}',
      NC: '{PREFIX}/NC/{FY}/{SEQ:4}',
    } as Record<string, string>,
    validate: (v: unknown) => typeof v === 'object' && v !== null && Object.values(v).every((f) => numberFormatProblem(f) === null),
    label: 'Document number formats',
    group: 'Numbering',
  },
  'report.formatNo': { default: 'QF-01', validate: isStr, label: 'Report format no.', group: 'Report format' },
  'report.issueNo': { default: '01', validate: isStr, label: 'Issue no.', group: 'Report format' },
  'report.issueDate': { default: '', validate: isStr, label: 'Issue date', group: 'Report format' },
  'report.revisionNo': { default: '00', validate: isStr, label: 'Format revision no.', group: 'Report format' },
  'report.revisionDate': { default: '', validate: isStr, label: 'Format revision date', group: 'Report format' },
  'report.samplingStatement': {
    default: 'Sample not drawn by our laboratory. The results relate only to the items tested.',
    validate: isStr,
    label: 'Sampling statement',
    group: 'Report format',
  },
  'quotation.defaultTitle': { default: 'Quotation', validate: (v: unknown) => v === 'Quotation' || v === 'Proforma Invoice', label: 'Default quotation title', group: 'Quotations' },
  'quotation.defaultValidityDays': { default: 30, validate: isNonNeg, label: 'Default validity (days)', group: 'Quotations' },
  'quotation.defaultPaymentTerms': { default: '100% within the agreed credit period', validate: isStr, label: 'Default payment terms', group: 'Quotations' },
  'credit.defaultDays': { default: 30, validate: isNonNeg, label: 'Default credit days', group: 'Accounts' },
  'einvoice.autoOnIssue': { default: true, validate: isBool, label: 'Register B2B invoices at the IRP when they are issued', group: 'E-invoicing', hidden: true },
  'einvoice.seller': {
    default: { line1: '', line2: '', city: '', pincode: '' } as { line1: string; line2: string; city: string; pincode: string },
    validate: (v: unknown) => {
      const a = v as Record<string, unknown> | null;
      return !!a && typeof a === 'object' && ['line1', 'line2', 'city', 'pincode'].every((k) => typeof a[k] === 'string') && (a.pincode === '' || /^[1-9][0-9]{5}$/.test(a.pincode as string));
    },
    label: 'Seller address for e-invoices',
    group: 'E-invoicing',
    hidden: true,
  },
  'reminders.enabled': { default: false, validate: isBool, label: 'Automatic invoice reminders', group: 'Accounts' },
  'reminders.scheduleDays': { default: [1, 7, 15, 30], validate: isIntArr(0, 365), label: 'Reminder days after due date', group: 'Accounts' },
  'calendar.workingDays': { default: [1, 2, 3, 4, 5, 6], validate: isIntArr(0, 6), label: 'Working days (0 = Sunday)', group: 'Calendar' },
  'retention.sampleDays': { default: 90, validate: isNonNeg, label: 'Sample retention (days)', group: 'Retention' },
  'retention.reportYears': { default: 5, validate: isNonNeg, label: 'Report retention (years)', group: 'Retention' },
  'controls.allowSelfApproval': { default: false, validate: isBool, label: 'Allow self-approval of results', group: 'Controls', sensitive: true },
  'controls.allowSameReviewerSignatory': { default: false, validate: isBool, label: 'Allow same reviewer and signatory', group: 'Controls', sensitive: true },
  'controls.impartiality': { default: true, validate: isBool, label: 'Hide customer identity from technicians', group: 'Controls', sensitive: true },
  'controls.blockOverdueInstruments': { default: false, validate: isBool, label: 'Block instruments past calibration due date', group: 'Controls' },
  // TODO(product-decision): warn (default) rather than refuse when a test goes to someone not authorised for it.
  'controls.requireAuthorisation': { default: false, validate: isBool, label: 'Refuse to assign a test to someone not authorised for it', group: 'Controls', sensitive: true },
  // TODO(product-decision): 15 days' notice before calibration or maintenance falls due.
  'quality.dueWarningDays': { default: 15, validate: isNonNeg, label: 'Warn this many days before equipment is due', group: 'Quality' },
  // TODO(product-decision): 30 days to answer a privacy request; the DPDP Rules leave the period to the lab's notice.
  'privacy.responseDays': { default: 30, validate: isNonNeg, label: 'Days to answer a privacy request', group: 'Privacy' },
  'notifications.tatWarningDays': { default: 1, validate: isNonNeg, label: 'Warn this many days before TAT', group: 'Notifications' },
  'setup.completed': { default: false, validate: isBool, label: 'First-run setup completed', group: 'System', hidden: true },
  'setup.labCompleted': { default: false, validate: isBool, label: 'Lab setup wizard finished', group: 'System', hidden: true },
  'setup.emailTested': { default: false, validate: isBool, label: 'Test email sent from setup', group: 'System', hidden: true },
} as const satisfies Record<string, { default: unknown; validate: Validator; label: string; group: string; sensitive?: boolean; hidden?: boolean }>;

export type SettingKey = keyof typeof SETTINGS;
type Widen<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : T extends readonly (infer U)[] ? Widen<U>[] : T;
export type SettingValue<K extends SettingKey> = Widen<(typeof SETTINGS)[K]['default']>;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SettingKey>(key: K, tx?: Tx): Promise<SettingValue<K>> {
    const row = await (tx ?? this.prisma).setting.findUnique({ where: { key } });
    return (row ? row.value : SETTINGS[key].default) as SettingValue<K>;
  }

  async all() {
    const rows = await this.prisma.setting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return (Object.keys(SETTINGS) as SettingKey[])
      .filter((key) => !('hidden' in SETTINGS[key]))
      .map((key) => {
        const def = SETTINGS[key];
        const row = byKey.get(key);
        return { key, label: def.label, group: def.group, value: row?.value ?? def.default, version: row?.version ?? 0, default: def.default, sensitive: 'sensitive' in def };
      });
  }

  /** `expectedVersion` 0 means the setting has never been saved. */
  async set(key: string, value: unknown, expectedVersion: number, reason?: string | null, tx?: Tx): Promise<void> {
    const def = SETTINGS[key as SettingKey];
    if (!def) throw badRequest(`Unknown setting ${key}`, [{ field: 'key', message: 'Unknown setting' }]);
    if (!def.validate(value)) throw badRequest(`Invalid value for ${def.label}`, [{ field: 'value', message: 'Invalid value' }]);
    if ('sensitive' in def && !reason?.trim()) {
      throw badRequest('A reason is required to change this control', [{ field: 'reason', message: 'A reason is required' }]);
    }
    const run = async (t: Tx) => {
      const existing = await t.setting.findUnique({ where: { key } });
      if ((existing?.version ?? 0) !== expectedVersion) throw conflict();
      if (existing) {
        const { count } = await t.setting.updateMany({
          where: { key, version: expectedVersion },
          data: { value: value as Prisma.InputJsonValue, version: { increment: 1 } },
        });
        if (count !== 1) throw conflict();
      } else {
        await t.setting.create({ data: { key, value: value as Prisma.InputJsonValue } });
      }
      await this.audit.record({ action: 'setting.update', entity: 'Setting', entityId: key, before: { value: existing?.value ?? def.default }, after: { value }, reason }, t);
    };
    if (tx) await run(tx);
    else await this.prisma.$transaction(run);
  }
}
