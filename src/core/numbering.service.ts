import { Inject, Injectable } from '@nestjs/common';
import { financialYear } from '../common/india.js';
import { COMPANY_CONFIG, type CompanyConfig } from '../config/company.config.js';
import type { Tx } from './prisma.service.js';
import { SettingsService } from './settings.service.js';

export type SeriesCode = 'CUSTOMER' | 'ORDER' | 'QUOTATION' | 'JOB' | 'SAMPLE' | 'PLAN' | 'REPORT' | 'DISPATCH' | 'INVOICE' | 'CREDIT_NOTE' | 'PAYMENT' | 'ULR';

/** Replaces {PREFIX}, {FY} and {SEQ:n}. Exported so ULR and number formats share one implementation. */
export function renderNumber(format: string, values: { prefix: string; fy: string; seq: number; extra?: Record<string, string> }): string {
  let out = format
    .replaceAll('{PREFIX}', values.prefix)
    .replaceAll('{FY}', values.fy)
    .replace(/\{SEQ(?::(\d+))?\}/g, (_, width) => String(values.seq).padStart(Number(width ?? 1), '0'));
  for (const [k, v] of Object.entries(values.extra ?? {})) out = out.replaceAll(`{${k}}`, v);
  return out;
}

@Injectable()
export class NumberingService {
  constructor(
    private readonly settings: SettingsService,
    @Inject(COMPANY_CONFIG) private readonly company: CompanyConfig,
  ) {}

  /**
   * Must run inside the caller's transaction. The upsert takes a row lock until commit, so
   * concurrent creators serialise per series and a rollback does not burn a number.
   */
  async next(tx: Tx, code: SeriesCode, at: Date = new Date(), formatOverride?: string): Promise<string> {
    // Customer numbers are lifetime-unique; everything else resets each financial year.
    const fy = code === 'CUSTOMER' ? 'ALL' : financialYear(at);
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "NumberSeries" ("code", "fy", "nextValue", "updatedAt")
      VALUES (${code}, ${fy}, 2, now())
      ON CONFLICT ("code", "fy") DO UPDATE
        SET "nextValue" = "NumberSeries"."nextValue" + 1, "updatedAt" = now()
      RETURNING "nextValue" - 1 AS value`;
    const formats = await this.settings.get('numbering.formats', tx);
    const format = formatOverride ?? formats[code] ?? `{PREFIX}/${code}/{FY}/{SEQ:5}`;
    return renderNumber(format, { prefix: this.company.documentPrefix, fy: financialYear(at), seq: Number(rows[0].value) });
  }
}
