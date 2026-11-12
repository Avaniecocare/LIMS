/** A YYYY-MM-DD date (a longer ISO string is cut to its date) as UTC midnight, the way date-only columns are stored. */
export const dateOnly = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00Z`);

/** Working-day arithmetic on date-only values (UTC midnight). Pure, so it can be tested directly. */
export function addWorkingDays(start: Date, days: number, workingDays: number[], holidays: Set<string>): Date {
  if (workingDays.length === 0) throw new Error('At least one working day is required');
  const isWorking = (d: Date) => workingDays.includes(d.getUTCDay()) && !holidays.has(d.toISOString().slice(0, 10));
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  // A sample received on a non-working day starts its clock on the next working day.
  while (!isWorking(d)) d.setUTCDate(d.getUTCDate() + 1);
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorking(d)) remaining--;
  }
  return d;
}
