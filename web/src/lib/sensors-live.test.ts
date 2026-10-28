import { describe, expect, it } from 'vitest';
import { addedSince, ageParts, fingerprint, SENSORS_REFRESH_MS, tableRefresh } from './sensors-live';

describe('ageParts', () => {
  it.each([[0, 's', 0], [999, 's', 0], [1000, 's', 1], [4_200, 's', 4], [59_999, 's', 59], [60_000, 'min', 1], [125_000, 'min', 2], [3_599_999, 'min', 59], [3_600_000, 'h', 1], [7_300_000, 'h', 2]])('%i ms -> %s %i', (ms, unit, n) => { expect(ageParts(ms)).toEqual({ unit, n }); });
  it('never negative (a clock a little behind the server)', () => { expect(ageParts(-5000)).toEqual({ unit: 's', n: 0 }); });
});

describe('tableRefresh', () => {
  it('first page + new readings -> refresh silently (no «loading…» flicker)', () => { expect(tableRefresh({ ready: true, changed: true, offset: 0 })).toBe('silent'); });
  it('another page + new readings -> do NOT move the rows, just say so', () => { expect(tableRefresh({ ready: true, changed: true, offset: 50 })).toBe('notice'); });
  it('nothing changed, or not loaded yet -> nothing to do', () => {
    expect(tableRefresh({ ready: true, changed: false, offset: 0 })).toBe('none');
    expect(tableRefresh({ ready: true, changed: false, offset: 100 })).toBe('none');
    expect(tableRefresh({ ready: false, changed: true, offset: 0 })).toBe('none');
  });
});

describe('addedSince', () => {
  it('counts what arrived after the screen was opened', () => { expect(addedSince(4200, 4452)).toBe(252); expect(addedSince(4200, 4200)).toBe(0); });
  it('is zero before the first load and never negative after a demo reset', () => { expect(addedSince(null, 4200)).toBe(0); expect(addedSince(4452, 4200)).toBe(0); });
});

describe('fingerprint', () => {
  it('ignores the server time (asOf), however deep, so an unchanged answer is recognized', () => {
    expect(fingerprint({ asOf: 'a', x: 1, n: { asOf: 'b' } }, { y: 2 })).toBe(fingerprint({ asOf: 'zzz', x: 1, n: { asOf: 'c' } }, { y: 2 }));
  });
  it('notices a real change', () => { expect(fingerprint({ x: 1 })).not.toBe(fingerprint({ x: 2 })); });
});

it('the refresh is every 10 seconds', () => { expect(SENSORS_REFRESH_MS).toBe(10_000); });
