import { Injectable } from '@nestjs/common';
import { financialYear } from '../common/india.js';
import { CompanyService } from './company.service.js';
import type { Tx } from './prisma.service.js';
import { SettingsService } from './settings.service.js';

export type SeriesCode = 'CUSTOMER' | 'ORDER' | 'QUOTATION' | 'JOB' | 'SAMPLE' | 'PLAN' | 'REPORT' | 'DISPATCH' | 'INVOICE' | 'CREDIT_NOTE' | 'PAYMENT' | 'ULR' | 'NC';

/** The calendar year in India, as two digits. */
export const calendarYear = (at: Date): string => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: '2-digit' }).format(at);

/**
 * When a series starts again at 1: each financial year if its numbers show it ({FY}), each calendar year if they show
 * that ({YY}), otherwise never, because the same number would come round again. Customer numbers last for life.
 */
export function seriesKey(code: SeriesCode, format: string, at: Date): string {
  if (code === 'CUSTOMER') return 'ALL';
  if (format.includes('{FY}')) return financialYear(at);
  return format.includes('{YY}') ? `Y${calendarYear(at)}` : 'ALL';
}

/** Replaces {PREFIX}, {FY}, {YY} and {SEQ:n}. Exported so ULR and number formats share one implementation. */
export function renderNumber(format: string, values: { prefix: string; fy: string; yy?: string; seq: number; extra?: Record<string, string> }): string {
  let out = format
    .replaceAll('{PREFIX}', values.prefix)
    .replaceAll('{FY}', values.fy)
    .replaceAll('{YY}', values.yy ?? calendarYear(new Date()))
    .replace(/\{SEQ(?::(\d+))?\}/g, (_, width) => String(values.seq).padStart(Number(width ?? 1), '0'));
  for (const [k, v] of Object.entries(values.extra ?? {})) out = out.replaceAll(`{${k}}`, v);
  return out;
}

@Injectable()
export class NumberingService {
  constructor(
    private readonly settings: SettingsService,
    private readonly company: CompanyService,
  ) {}

  /**
   * Must run inside the caller's transaction. The upsert takes a row lock until commit, so
   * concurrent creators serialise per series and a rollback does not burn a number.
   */
  async next(tx: Tx, code: SeriesCode, at: Date = new Date(), formatOverride?: string): Promise<string> {
    const formats = await this.settings.get('numbering.formats', tx);
    const format = formatOverride ?? formats[code] ?? `{PREFIX}/${code}/{FY}/{SEQ:5}`;
    const key = seriesKey(code, format, at);
    // A series that stops resetting carries on after the highest number it has ever given.
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "NumberSeries" ("code", "fy", "nextValue", "updatedAt")
      VALUES (${code}, ${key}, CASE WHEN ${key} = 'ALL' THEN COALESCE((SELECT MAX("nextValue") FROM "NumberSeries" WHERE "code" = ${code}), 1) ELSE 1 END + 1, now())
      ON CONFLICT ("code", "fy") DO UPDATE
        SET "nextValue" = "NumberSeries"."nextValue" + 1, "updatedAt" = now()
      RETURNING "nextValue" - 1 AS value`;
    return renderNumber(format, { prefix: this.company.config.documentPrefix, fy: financialYear(at), yy: calendarYear(at), seq: Number(rows[0].value) });
  }
}
