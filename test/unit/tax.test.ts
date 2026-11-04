import { describe, expect, it } from 'vitest';
import { computeTax, lineAmount } from '../../src/modules/billing/tax.js';

const lines = [550, 550, 1100, 550, 10450];

describe('GST', () => {
  it('intra-state: CGST + SGST', () => {
    const t = computeTax({ amounts: lines, gstRate: 18, customerStateCode: '27', labStateCode: '27' });
    expect(t).toMatchObject({ subtotal: '13200.00', taxableAmount: '13200.00', cgst: '1188.00', sgst: '1188.00', igst: '0.00', grandTotal: '15576.00', isInterState: false });
    expect(t.amountInWords).toBe('Fifteen Thousand Five Hundred Seventy-Six Only');
  });

  it('inter-state: IGST', () => {
    const t = computeTax({ amounts: lines, gstRate: 18, customerStateCode: '29', labStateCode: '27' });
    expect(t).toMatchObject({ subtotal: '13200.00', cgst: '0.00', sgst: '0.00', igst: '2376.00', grandTotal: '15576.00', isInterState: true });
  });

  it('rounds the grand total and shows round-off', () => {
    const t = computeTax({ amounts: ['100.50'], gstRate: 18, customerStateCode: '27', labStateCode: '27' });
    // 100.50 + 9.05 + 9.05 = 118.60 -> 119
    expect(t).toMatchObject({ cgst: '9.05', sgst: '9.05', grandTotal: '119.00', roundOff: '0.40' });
  });

  it('applies a header discount before tax', () => {
    const t = computeTax({ amounts: [1000], discountPct: 10, gstRate: 18, customerStateCode: '27', labStateCode: '27' });
    expect(t).toMatchObject({ discountAmount: '100.00', taxableAmount: '900.00', cgst: '81.00', grandTotal: '1062.00' });
  });

  it('honours a different rate from settings and a zero rate', () => {
    expect(computeTax({ amounts: [1000], gstRate: 12, customerStateCode: '27', labStateCode: '29' }).igst).toBe('120.00');
    expect(computeTax({ amounts: [1000], gstRate: 0, customerStateCode: '27', labStateCode: '27' }).grandTotal).toBe('1000.00');
  });

  it('never drifts through floats', () => {
    expect(computeTax({ amounts: ['0.10', '0.20'], gstRate: 0, customerStateCode: '27', labStateCode: '27' }).subtotal).toBe('0.30');
  });

  it('calculates line amounts', () => {
    expect(lineAmount(3, '550.00')).toBe('1650.00');
    expect(lineAmount(2, '333.33', 10)).toBe('599.99'); // 666.66 less 10% is 599.994
  });
});
