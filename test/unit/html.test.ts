import { describe, expect, it } from 'vitest';
import { dateOnly } from '../../src/common/calendar.js';
import { escapeHtml } from '../../src/common/html.js';

describe('escapeHtml', () => {
  it('escapes everything that can break out of text or a quoted attribute', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>Tom & Jerry</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;');
  });
  it('turns null and undefined into nothing, and numbers into text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('dateOnly', () => {
  it('reads a date, or the date part of a timestamp, as UTC midnight', () => {
    expect(dateOnly('2026-11-12').toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(dateOnly('2026-11-12T18:30:00+05:30').toISOString()).toBe('2026-11-12T00:00:00.000Z');
  });
});
