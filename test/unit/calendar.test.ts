import { describe, expect, it } from 'vitest';
import { addWorkingDays } from '../../src/common/calendar.js';

const MON_SAT = [1, 2, 3, 4, 5, 6];
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe('working-day calendar', () => {
  it('skips Sundays', () => expect(iso(addWorkingDays(d('2026-11-06'), 2, MON_SAT, new Set()))).toBe('2026-11-09')); // Fri + 2 = Sat, Mon
  it('skips holidays', () => expect(iso(addWorkingDays(d('2026-11-06'), 2, MON_SAT, new Set(['2026-11-07'])))).toBe('2026-11-10'));
  it('starts the clock on the next working day', () => expect(iso(addWorkingDays(d('2026-11-08'), 1, MON_SAT, new Set()))).toBe('2026-11-10')); // Sun -> Mon, +1
  it('handles zero days', () => expect(iso(addWorkingDays(d('2026-11-08'), 0, MON_SAT, new Set()))).toBe('2026-11-09'));
  it('honours a five-day week', () => expect(iso(addWorkingDays(d('2026-11-06'), 1, [1, 2, 3, 4, 5], new Set()))).toBe('2026-11-09'));
  it('rejects an empty week', () => expect(() => addWorkingDays(d('2026-11-06'), 1, [], new Set())).toThrow());
});
