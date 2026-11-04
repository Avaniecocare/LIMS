import { describe, expect, it } from 'vitest';
import { amountInWords, financialYear, formatDate, formatINR, gstinCheckChar, isValidGstin } from '../../src/common/india.js';

describe('regional helpers', () => {
  it('formats Indian digit grouping', () => {
    expect(formatINR('123456')).toBe('1,23,456.00');
    expect(formatINR('999')).toBe('999.00');
    expect(formatINR('1000')).toBe('1,000.00');
    expect(formatINR('10000000.5')).toBe('1,00,00,000.50');
    expect(formatINR('-1234.5')).toBe('-1,234.50');
  });

  it('writes amounts in Indian words', () => {
    expect(amountInWords(15576)).toBe('Fifteen Thousand Five Hundred Seventy-Six Only');
    expect(amountInWords(0)).toBe('Zero Only');
    expect(amountInWords(100000)).toBe('One Lakh Only');
    expect(amountInWords('12345678.50')).toBe('One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Fifty Paise Only');
  });

  it('labels the financial year in IST, switching on 1 April', () => {
    expect(financialYear(new Date('2026-04-01T00:00:00+05:30'))).toBe('26-27');
    expect(financialYear(new Date('2026-03-31T23:59:59+05:30'))).toBe('25-26');
    // 31 March 20:00 UTC is already 1 April in India
    expect(financialYear(new Date('2026-03-31T20:00:00Z'))).toBe('26-27');
  });

  it('prints DD-Mon-YYYY', () => {
    expect(formatDate(new Date('2026-11-04T00:00:00Z'))).toBe('04-Nov-2026');
    expect(formatDate(new Date('2026-11-04T20:00:00Z'))).toBe('05-Nov-2026');
  });

  it('validates GSTIN format and check digit', () => {
    expect(isValidGstin('27AAAAA0000A1Z2')).toBe(true);
    expect(isValidGstin('27AAAAA0000A1Z3')).toBe(false);
    expect(isValidGstin('nonsense')).toBe(false);
    expect(gstinCheckChar('29BBBBB1111B1Z')).toBe('J');
  });
});
