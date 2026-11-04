/** Overdue and ageing are calculated from the due date, never stored or set by hand. */
export const AGEING_BUCKETS = ['Not Due', '0-30', '31-60', '61-90', '90+'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

const DAY = 86_400_000;

export function daysOverdue(dueDate: Date, today: Date): number {
  return Math.round((today.getTime() - dueDate.getTime()) / DAY);
}

/** Due today is still Not Due. One day late falls in 0-30; 30 is the last day of that bucket. */
export function ageingBucket(dueDate: Date, today: Date): AgeingBucket {
  const days = daysOverdue(dueDate, today);
  if (days <= 0) return 'Not Due';
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/** Date range of due dates that fall in a bucket, for filtering in SQL. */
export function bucketDueDateRange(bucket: AgeingBucket, today: Date): { gte?: Date; lte?: Date } {
  const offset = (d: number) => new Date(today.getTime() - d * DAY);
  switch (bucket) {
    case 'Not Due':
      return { gte: today };
    case '0-30':
      return { lte: offset(1), gte: offset(30) };
    case '31-60':
      return { lte: offset(31), gte: offset(60) };
    case '61-90':
      return { lte: offset(61), gte: offset(90) };
    case '90+':
      return { lte: offset(91) };
  }
}
