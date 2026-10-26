import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { formatCop, formatCount, formatDay, formatInstant, monthNames, timeAgo } from './format';

describe('formatDay / formatInstant (built by hand in UTC, the same in every browser)', () => {
  it('English', () => { expect(formatDay('2026-11-17T10:00:00.000Z', 'en')).toBe('17 Nov 2026'); expect(formatInstant('2026-09-13T11:14:00.000Z', 'en')).toBe('13 Sep 2026, 11:14 UTC'); });
  it('Spanish', () => { expect(formatDay('2026-11-17T10:00:00.000Z', 'es')).toBe('17 nov 2026'); expect(formatDay('2026-09-13T00:05:00.000Z', 'es')).toBe('13 sep 2026'); });
  it('an instant near midnight stays on its UTC day whatever the browser zone is', () => { expect(formatDay('2026-01-05T23:59:00.000Z', 'en')).toBe('5 Jan 2026'); expect(formatDay('2026-01-06T00:01:00.000Z', 'en')).toBe('6 Jan 2026'); });
  it('both languages name twelve different months', () => { for (const l of ['es', 'en'] as const) expect(new Set(monthNames[l]).size).toBe(12); });
});

describe('formatCount: fixed thousands separator per language', () => {
  it.each([[4200, '4.200', '4,200'], [21, '21', '21'], [0, '0', '0'], [999, '999', '999'], [1000, '1.000', '1,000'], [1234567, '1.234.567', '1,234,567'], [-4200, '-4.200', '-4,200']])('%s', (n, es, en) => {
    expect(formatCount(n, 'es')).toBe(es); expect(formatCount(n, 'en')).toBe(en);
  });
});

describe('timeAgo uses the language of the screen', () => {
  const now = Date.parse('2026-10-25T12:00:00Z'); const at = (s: number) => new Date(now - s * 1000).toISOString();
  const es = makeT('es'), en = makeT('en');
  it.each([[2, 'justo ahora', 'just now'], [30, 'hace 30 s', '30 s ago'], [300, 'hace 5 min', '5 min ago'], [7200, 'hace 2 h', '2 h ago'], [172800, 'hace 2 días', '2 days ago']])('%s s', (s, e, n) => {
    expect(timeAgo(at(s), now, es)).toBe(e); expect(timeAgo(at(s), now, en)).toBe(n);
  });
  it('a date that cannot be read is a dash, in both', () => { expect(timeAgo('not a date', now, es)).toBe('—'); expect(timeAgo('not a date', now, en)).toBe('—'); });
  it('money is written the same in both languages', () => expect(formatCop(12000000)).toBe(new Intl.NumberFormat('es-CO').format(12000000)));
});
