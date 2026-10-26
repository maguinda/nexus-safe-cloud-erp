import { describe, expect, it } from 'vitest';
import { areaPath, bandLayout, changePct, extent, fraction, isFiniteNumber, linePath, linearScale, niceDomain, niceTicks, polar, ringPath, spreadLabels, timeTicks } from './scale';
import { formatClock, formatDayMonth, formatInstantMs, formatNumber, formatPercent, formatTick, formatTimeTick } from './format';

const T = (iso: string) => Date.parse(iso);

describe('extent and finite numbers', () => {
  it('ignores NaN, Infinity, null, undefined and strings', () => expect(extent([3, NaN, Infinity, -Infinity, null, undefined, '7', 9, -2])).toEqual([-2, 9]));
  it('is null when nothing is finite or the list is empty', () => { expect(extent([])).toBeNull(); expect(extent([NaN, Infinity])).toBeNull(); });
  it('isFiniteNumber is strict', () => { for (const v of [0, -1, 1.5]) expect(isFiniteNumber(v)).toBe(true); for (const v of [NaN, Infinity, '1', null, undefined]) expect(isFiniteNumber(v)).toBe(false); });
});

describe('niceTicks', () => {
  it('rounds to clean numbers that cover the data', () => { expect(niceTicks(0, 97)).toEqual([0, 20, 40, 60, 80, 100]); expect(niceTicks(21.2, 24.4)).toEqual([21, 22, 23, 24, 25]); });
  it('works with negative values and across zero', () => { expect(niceTicks(-3, 7)).toEqual([-4, -2, 0, 2, 4, 6, 8]); expect(niceTicks(-100, -20)).toEqual([-100, -80, -60, -40, -20]); });
  it('opens a range when all values are equal (and also at zero)', () => { const a = niceTicks(5, 5); expect(a[0]).toBeLessThan(5); expect(a[a.length - 1]).toBeGreaterThan(5); expect(niceTicks(0, 0)).toEqual([-1, -0.5, 0, 0.5, 1]); });
  it('has no floating-point noise', () => { for (const v of niceTicks(0, 0.7, 5)) expect(String(v).length).toBeLessThan(6); expect(niceTicks(0, 0.7)).toEqual([0, 0.2, 0.4, 0.6, 0.8]); expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]); });
  it('survives huge and tiny ranges and never loops forever', () => { expect(niceTicks(0, 1e12).length).toBeLessThan(12); expect(niceTicks(0, 1e-9).length).toBeGreaterThan(1); });
  it('is empty for non-finite input', () => { expect(niceTicks(NaN, 3)).toEqual([]); expect(niceTicks(0, Infinity)).toEqual([]); });
  it('the first tick is at or below min and the last at or above max', () => { for (const [a, b] of [[0.3, 9.9], [-4.2, 3.1], [1000, 1234], [2, 2.001]]) { const t = niceTicks(a, b); expect(t[0]).toBeLessThanOrEqual(a); expect(t[t.length - 1]).toBeGreaterThanOrEqual(b); } });
});

describe('niceDomain', () => {
  it('bars keep the zero in the axis', () => { const d = niceDomain([40, 55, 62], { includeZero: true }); expect(d.min).toBe(0); expect(d.max).toBeGreaterThanOrEqual(62); });
  it('lines do not need the zero', () => { const d = niceDomain([21.2, 24.4]); expect(d.min).toBeGreaterThan(0); });
  it('all zeros give an axis, not a collapsed one', () => { const d = niceDomain([0, 0, 0], { includeZero: true }); expect(d.max).toBeGreaterThan(d.min); });
  it('nothing finite gives 0..1', () => expect(niceDomain([NaN, null, undefined])).toEqual(expect.objectContaining({ min: 0, max: 1 })));
  it('a fixed max (a percentage) is respected and ticks do not go past it', () => { const d = niceDomain([12, 40], { min: 0, max: 100 }); expect(d.max).toBe(100); expect(Math.max(...d.ticks)).toBeLessThanOrEqual(100); });
  it('a single value and negatives', () => { const d = niceDomain([-7], { includeZero: true }); expect(d.min).toBeLessThanOrEqual(-7); expect(d.max).toBeGreaterThanOrEqual(0); });
});

describe('linearScale', () => {
  it('maps the ends and the middle', () => { const s = linearScale(0, 10, 100, 200); expect([s(0), s(5), s(10)]).toEqual([100, 150, 200]); });
  it('can invert (SVG y grows downwards)', () => { const s = linearScale(0, 10, 200, 100); expect([s(0), s(10)]).toEqual([200, 100]); });
  it('a one-value domain returns the middle of the range, never NaN', () => { expect(linearScale(5, 5, 0, 100)(5)).toBe(50); expect(Number.isNaN(linearScale(NaN, 3, 0, 1)(1))).toBe(false); });
});

describe('timeTicks (UTC)', () => {
  it('aligns to round clock times', () => { const t = timeTicks(T('2026-09-13T08:01:00Z'), T('2026-09-13T11:20:00Z'), 5); expect(t.map(formatClock)).toEqual(['08:30', '09:00', '09:30', '10:00', '10:30', '11:00']); });
  it('picks a coarser step for a longer span', () => { const t = timeTicks(T('2026-09-13T00:00:00Z'), T('2026-09-16T00:00:00Z'), 4); expect(t.length).toBeLessThanOrEqual(5); expect(t.every((x) => x % 86_400_000 === 0)).toBe(true); });
  it('one instant, reversed or non-finite input', () => { expect(timeTicks(5, 5)).toEqual([5]); expect(timeTicks(T('2026-09-13T11:00:00Z'), T('2026-09-13T09:00:00Z')).length).toBeGreaterThan(1); expect(timeTicks(NaN, 5)).toEqual([]); });
  it('does not depend on the time zone of the machine', () => { expect(formatClock(T('2026-09-13T00:05:00Z'))).toBe('00:05'); });
});

describe('geometry', () => {
  it('bandLayout caps the thickness and centres the mark in its band', () => { const b = bandLayout(4, 400, 24); expect(b.thickness).toBe(24); expect(b.step).toBe(100); expect(b.offset(0)).toBe(38); expect(bandLayout(40, 400, 24).thickness).toBeLessThan(24); });
  it('bandLayout never has zero or NaN size', () => { for (const n of [0, 1, -3, 1000]) { const b = bandLayout(n, 300, 24); expect(b.thickness).toBeGreaterThanOrEqual(1); expect(Number.isFinite(b.offset(0))).toBe(true); } });
  it('linePath breaks at gaps and drops non-finite points', () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 1, y: 2 }, null, { x: 3, y: 4 }])).toBe('M0 1L1 2M3 4');
    expect(linePath([{ x: NaN, y: 1 }, { x: 1, y: Infinity }])).toBe('');
    expect(linePath([])).toBe('');
  });
  it('areaPath closes each run on the baseline', () => { const d = areaPath([{ x: 0, y: 5 }, { x: 10, y: 3 }, null, { x: 20, y: 4 }], 10); expect(d.split('Z').filter(Boolean)).toHaveLength(2); expect(d).not.toMatch(/NaN|undefined/); });
  it('polar starts at 12 o’clock and goes clockwise', () => { expect(polar(0, 0, 10, 0)).toEqual({ x: 0, y: -10 }); expect(polar(0, 0, 10, Math.PI / 2)).toEqual({ x: 10, y: 0 }); });
  it('ringPath is a closed shape, full turns split in two and degenerate input is empty', () => {
    expect(ringPath(50, 50, 40, 30, 0, 1)).toMatch(/^M.*Z$/);
    expect((ringPath(50, 50, 40, 30, 0, Math.PI * 2).match(/Z/g) ?? []).length).toBe(2);
    expect(ringPath(50, 50, 30, 40, 0, 1)).toBe(''); expect(ringPath(50, 50, 40, 30, 2, 1)).toBe(''); expect(ringPath(50, 50, 40, 30, NaN, 1)).toBe('');
    expect(ringPath(50, 50, 40, 30, 0, 3)).not.toMatch(/NaN/);
  });
});

describe('changePct, fraction, spreadLabels', () => {
  it('changePct', () => { expect(changePct(100, 112.5)).toBeCloseTo(12.5); expect(changePct(50, 25)).toBeCloseTo(-50); expect(changePct(0, 5)).toBeNull(); expect(changePct(null, 5)).toBeNull(); expect(changePct(5, NaN)).toBeNull(); expect(changePct(-10, -5)).toBeCloseTo(50); });
  it('fraction is clamped and safe', () => { expect(fraction(5, 0, 10)).toBe(0.5); expect(fraction(-5, 0, 10)).toBe(0); expect(fraction(50, 0, 10)).toBe(1); expect(fraction(3, 3, 3)).toBe(1); expect(fraction(0, 0, 0)).toBe(0); expect(fraction(NaN, 0, 10)).toBe(0); });
  it('spreadLabels separates labels and keeps the input order', () => {
    const out = spreadLabels([100, 102, 101, 300], 14, 0, 400);
    expect(out[3]).toBe(300);
    const near = [out[0], out[2], out[1]]; for (let i = 1; i < near.length; i++) expect(near[i] - near[i - 1]).toBeGreaterThanOrEqual(14 - 1e-9);
    expect(out.every((v) => v >= 0 && v <= 400)).toBe(true);
  });
  it('spreadLabels stays inside the box even when they are too many', () => { const out = spreadLabels([0, 1, 2, 3, 4], 20, 0, 50); expect(out.every((v) => v >= 0 && v <= 50)).toBe(true); });
});

describe('number and date formatting (per language, same in every browser)', () => {
  it('formatNumber', () => {
    expect(formatNumber(1234.5, 'es')).toBe('1.234,5'); expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(22.5, 'es')).toBe('22,5'); expect(formatNumber(4200, 'es', 0)).toBe('4.200'); expect(formatNumber(3, 'en')).toBe('3'); expect(formatNumber(0, 'es')).toBe('0');
    expect(formatNumber(-0.04, 'en', 1)).toBe('0'); expect(formatNumber(-12.3, 'es')).toBe('-12,3');
  });
  it('formatNumber turns anything that is not finite into a dash, never "NaN"', () => { for (const v of [NaN, Infinity, -Infinity, null, undefined, '5']) expect(formatNumber(v, 'es')).toBe('—'); });
  it('formatTick is compact from a thousand', () => { expect(formatTick(0, 'en')).toBe('0'); expect(formatTick(999, 'en')).toBe('999'); expect(formatTick(1000, 'en')).toBe('1K'); expect(formatTick(2500, 'es')).toBe('2,5K'); expect(formatTick(1_200_000, 'en')).toBe('1.2M'); expect(formatTick(-3000, 'en')).toBe('-3K'); expect(formatTick(NaN, 'en')).toBe('—'); });
  it('formatPercent', () => { expect(formatPercent(12.5, 'es')).toBe('12,5 %'); expect(formatPercent(12.5, 'en')).toBe('12.5%'); expect(formatPercent(NaN, 'en')).toBe('—'); });
  it('dates are UTC and per language', () => {
    const ms = T('2026-09-13T11:14:00Z');
    expect(formatClock(ms)).toBe('11:14'); expect(formatDayMonth(ms, 'es')).toBe('13 sep'); expect(formatDayMonth(ms, 'en')).toBe('13 Sep');
    expect(formatInstantMs(ms, 'es')).toBe('13 sep 2026, 11:14 UTC'); expect(formatInstantMs(ms, 'en')).toBe('13 Sep 2026, 11:14 UTC');
    expect(formatInstantMs(NaN, 'en')).toBe('—'); expect(formatClock(NaN)).toBe('—');
  });
  it('formatTimeTick shows only the hour within a day and the day over longer spans', () => {
    expect(formatTimeTick(T('2026-09-13T08:30:00Z'), 3 * 3_600_000, 'es')).toBe('08:30');
    expect(formatTimeTick(T('2026-09-14T00:00:00Z'), 5 * 86_400_000, 'es')).toBe('14 sep');
    expect(formatTimeTick(T('2026-09-14T06:00:00Z'), 5 * 86_400_000, 'en')).toBe('14 Sep 06:00');
  });
});
