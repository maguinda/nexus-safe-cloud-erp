import { newAllocation } from './allocation';
import { dayNumber, dayString } from './dates';
import { newEngineer } from './engineer';
import { ValidationError } from './errors';
import { loadOn, peakLoad, summarize } from './load';

const d = (s: string) => dayNumber(s, 'd');
const a = (percent: number, start: string, end: string) => ({ percent, start: d(start), end: d(end) });

describe('dates', () => {
  it('round-trips and counts days', () => { expect(dayString(d('2026-11-30'))).toBe('2026-11-30'); expect(d('2026-12-01') - d('2026-11-30')).toBe(1); });
  it('accepts a leap day only in leap years', () => { expect(() => d('2028-02-29')).not.toThrow(); expect(() => d('2027-02-29')).toThrow(ValidationError); });
  it.each(['2026-13-01', '2026-02-30', '2026-4-5', '26-01-01', '2026-01-01T00:00:00Z', '1999-12-31', '2101-01-01', '', 'tomorrow'])('rejects %s', (s) => { expect(() => d(s)).toThrow(ValidationError); });
  it.each([null, undefined, 20261130, {}, []])('rejects a non-string %p', (v) => { expect(() => dayNumber(v, 'x')).toThrow(ValidationError); });
});

describe('load', () => {
  it('adds the allocations that cover a day, both ends included', () => {
    const l = [a(60, '2026-11-02', '2026-11-10'), a(30, '2026-11-10', '2026-11-20')];
    expect(loadOn(l, d('2026-11-01'))).toBe(0); expect(loadOn(l, d('2026-11-02'))).toBe(60);
    expect(loadOn(l, d('2026-11-10'))).toBe(90); expect(loadOn(l, d('2026-11-11'))).toBe(30); expect(loadOn(l, d('2026-11-21'))).toBe(0);
  });
  it('finds the peak inside a range and the first day it happens', () => {
    const l = [a(60, '2026-11-02', '2026-11-10'), a(30, '2026-11-10', '2026-11-20'), a(20, '2026-11-15', '2026-11-30')];
    expect(peakLoad(l, d('2026-11-01'), d('2026-11-30'))).toEqual({ peak: 90, day: d('2026-11-10') });
    expect(peakLoad(l, d('2026-11-11'), d('2026-11-30'))).toEqual({ peak: 50, day: d('2026-11-15') });
    expect(peakLoad(l, d('2026-12-01'), d('2026-12-10'))).toEqual({ peak: 0, day: d('2026-12-01') });
  });
  it('allocations that only touch the end of the range or sit outside do not count wrongly', () => {
    const l = [a(100, '2026-10-01', '2026-10-31'), a(100, '2026-12-01', '2026-12-31')];
    expect(peakLoad(l, d('2026-11-01'), d('2026-11-30')).peak).toBe(0);
    expect(peakLoad(l, d('2026-10-31'), d('2026-11-30')).peak).toBe(100);
    expect(peakLoad(l, d('2026-11-30'), d('2026-12-01')).peak).toBe(100);
  });
  it('matches a day-by-day count on 300 random cases (the sweep is an optimisation, not a different rule)', () => {
    let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let t = 0; t < 300; t++) {
      const l = Array.from({ length: rnd(7) }, () => { const s = rnd(60); return { percent: 1 + rnd(100), start: s, end: s + rnd(30) }; });
      const from = rnd(60), to = from + rnd(40);
      let brute = 0; for (let day = from; day <= to; day++) brute = Math.max(brute, loadOn(l, day));
      expect(peakLoad(l, from, to).peak).toBe(brute);
    }
  });
  it('summarize never shows negative free time for an over-allocated engineer', () => {
    const s = summarize([a(70, '2026-11-01', '2026-11-30'), a(60, '2026-11-10', '2026-11-30')], d('2026-11-15'));
    expect(s).toEqual({ loadToday: 130, freeToday: 0, peakNext30: 130, minFreeNext30: 0 });
  });
  it('summarize looks 30 days ahead, not more', () => {
    const s = summarize([a(80, '2026-12-20', '2026-12-31')], d('2026-11-15'));
    expect(s.peakNext30).toBe(0); // 2026-12-20 es el día 36
    expect(summarize([a(80, '2026-12-14', '2026-12-31')], d('2026-11-15')).peakNext30).toBe(80); // el día 30 (14 dic) sí entra
  });
});

describe('engineer', () => {
  it('trims, collapses spaces and removes repeated tags ignoring case', () => {
    const e = newEngineer('  Ana   Torres ', 'Network engineer', ['Cisco', 'cisco', ' Terraform '], ['CCNP']);
    expect(e).toMatchObject({ name: 'Ana Torres', skills: ['Cisco', 'Terraform'], certifications: ['CCNP'] });
  });
  it('lists are optional', () => { expect(newEngineer('Ana Torres', 'Dev', undefined, null)).toMatchObject({ skills: [], certifications: [] }); });
  it.each([
    ['short name', ['A', 'Dev']], ['huge name', ['x'.repeat(81), 'Dev']], ['html in name', ['<b>Ana</b>', 'Dev']], ['number name', [5, 'Dev']], ['empty role', ['Ana Torres', ' ']],
    ['control char', ['Ana\u0000 Torres', 'Dev']],
  ])('rejects %s', (_n, [name, role]) => { expect(() => newEngineer(name, role, [], [])).toThrow(ValidationError); });
  it('rejects too many or strange tags', () => {
    expect(() => newEngineer('Ana Torres', 'Dev', Array.from({ length: 21 }, (_, i) => `skill-${i}`), [])).toThrow(ValidationError);
    expect(() => newEngineer('Ana Torres', 'Dev', 'Cisco', [])).toThrow(ValidationError);
    expect(() => newEngineer('Ana Torres', 'Dev', [3], [])).toThrow(ValidationError);
    expect(() => newEngineer('Ana Torres', 'Dev', ['x'], [])).toThrow(ValidationError);
  });
});

describe('allocation', () => {
  const ok = () => newAllocation('e1', 'Branch network upgrade', 50, '2026-11-02', '2026-11-30');
  it('builds a valid allocation', () => { expect(ok()).toMatchObject({ engineerId: 'e1', projectName: 'Branch network upgrade', percent: 50, start: d('2026-11-02'), end: d('2026-11-30') }); });
  it('a single day is fine', () => { expect(() => newAllocation('e1', 'Project', 100, '2026-11-02', '2026-11-02')).not.toThrow(); });
  it.each([[0], [101], [-5], [50.5], ['50'], [null], [NaN], [Infinity]])('rejects percent %p', (p) => { expect(() => newAllocation('e1', 'Project', p, '2026-11-02', '2026-11-30')).toThrow(ValidationError); });
  it('rejects an end before the start and a period longer than 3 years', () => {
    expect(() => newAllocation('e1', 'Project', 50, '2026-11-30', '2026-11-02')).toThrow(ValidationError);
    expect(() => newAllocation('e1', 'Project', 50, '2026-01-01', '2029-01-01')).toThrow(ValidationError);
    expect(() => newAllocation('e1', 'Project', 50, '2026-01-01', '2028-12-30')).not.toThrow();
  });
  it.each([[''], ['A'], ['x'.repeat(81)], ['<script>'], [7], [null]])('rejects project name %p', (n) => { expect(() => newAllocation('e1', n, 50, '2026-11-02', '2026-11-30')).toThrow(ValidationError); });
});
