import { describe, expect, it } from 'vitest';
import { numberFormatProblem } from '../../src/core/number-format.js';
import { calendarYear, renderNumber, seriesKey } from '../../src/core/numbering.service.js';

const at = (s: string) => new Date(s);

describe('number formats', () => {
  it('refuses tokens it would print as typed', () => {
    expect(numberFormatProblem('TC1234{YY}{SEQ:8}F')).toBeNull();
    expect(numberFormatProblem('{PREFIX}/INV/{FY}/{SEQ}')).toBeNull();
    expect(numberFormatProblem('TC{YYYY}{SEQ:8}')).toMatch(/\{YYYY\} is not a known token/);
    expect(numberFormatProblem('INV-{FY}')).toMatch(/must contain/i);
    expect(numberFormatProblem('INV-{SEQ:5')).toMatch(/brace/);
    expect(numberFormatProblem(5)).not.toBeNull();
  });

  it('prints the calendar year in India', () => {
    expect(calendarYear(at('2026-12-31T19:00:00Z'))).toBe('27');
    expect(renderNumber('TC1234{YY}{SEQ:8}F', { prefix: 'X', fy: '26-27', yy: '27', seq: 12 })).toBe('TC12342700000012F');
  });

  it('starts again only when the number shows the period', () => {
    const jan = at('2027-01-10T00:00:00Z');
    const apr = at('2027-04-10T00:00:00Z');
    expect(seriesKey('INVOICE', 'INV/{FY}/{SEQ:5}', jan)).toBe('26-27');
    expect(seriesKey('INVOICE', 'INV/{FY}/{SEQ:5}', apr)).toBe('27-28');
    expect(seriesKey('ULR', 'TC1{YY}{SEQ:8}F', jan)).toBe('Y27');
    // The same calendar year keeps one series across 1 April, so no number comes round twice in it.
    expect(seriesKey('ULR', 'TC1{YY}{SEQ:8}F', apr)).toBe('Y27');
    expect(seriesKey('INVOICE', 'INV-{SEQ:5}', apr)).toBe('ALL');
    expect(seriesKey('CUSTOMER', 'CRN-{FY}-{SEQ:5}', apr)).toBe('ALL');
  });
});
