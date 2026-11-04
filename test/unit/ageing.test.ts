import { describe, expect, it } from 'vitest';
import { ageingBucket, bucketDueDateRange, daysOverdue, AGEING_BUCKETS } from '../../src/modules/invoices/ageing.js';

const today = new Date('2026-11-04T00:00:00Z');
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

describe('ageing buckets', () => {
  it.each([
    [-10, 'Not Due'], [0, 'Not Due'], [1, '0-30'], [30, '0-30'], [31, '31-60'], [60, '31-60'], [61, '61-90'], [90, '61-90'], [91, '90+'], [400, '90+'],
  ] as const)('%i days overdue is %s', (days, bucket) => {
    expect(ageingBucket(daysAgo(days), today)).toBe(bucket);
    expect(daysOverdue(daysAgo(days), today)).toBe(days);
  });

  it('SQL ranges agree with the calculation at every boundary', () => {
    for (let days = -5; days <= 120; days++) {
      const due = daysAgo(days);
      const bucket = ageingBucket(due, today);
      for (const b of AGEING_BUCKETS) {
        const r = bucketDueDateRange(b, today);
        const inside = (!r.gte || due >= r.gte) && (!r.lte || due <= r.lte);
        expect(inside, `${days} days in ${b}`).toBe(b === bucket);
      }
    }
  });
});
