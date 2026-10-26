import { describe, expect, it } from 'vitest';
import { atLabel, avgLabel, count, num1, readingLabel, STATE_LABEL, windowLabel } from './telemetry';

describe('num1', () => {
  it.each([[24, '24'], [22.46, '22.5'], [49.94, '49.9'], [0, '0'], [1.2, '1.2'], [30.0, '30']])('%s -> %s', (n, e) => expect(num1(n)).toBe(e));
});

describe('readingLabel', () => {
  it('shows value and unit', () => expect(readingLabel({ unit: '°C', lastValue: 24, lastStatus: 'WARNING' })).toBe('24 °C'));
  it('keeps one decimal', () => expect(readingLabel({ unit: 'PPM', lastValue: 1.2, lastStatus: 'ALERT' })).toBe('1.2 PPM'));
  it('shows the status for yes/no signals, not 0 or 1', () => {
    expect(readingLabel({ unit: 'BOOL', lastValue: 1, lastStatus: 'LOCKED' })).toBe('LOCKED');
    expect(readingLabel({ unit: 'BOOL', lastValue: 0, lastStatus: 'CLEAR' })).toBe('CLEAR');
  });
  it('is a dash when there is no reading', () => expect(readingLabel({ unit: '°C', lastValue: null, lastStatus: null })).toBe('—'));
  it('is a dash for a yes/no signal with no status', () => expect(readingLabel({ unit: 'BOOL', lastValue: 1, lastStatus: null })).toBe('—'));
});

describe('windowLabel', () => {
  it('one day: date once, hours in UTC', () => expect(windowLabel({ from: '2026-09-13T08:01:00.000Z', to: '2026-09-13T11:20:00.000Z' })).toBe('13 Sep 2026, 08:01–11:20 UTC'));
  it('two days: both dates', () => expect(windowLabel({ from: '2026-09-13T23:30:00.000Z', to: '2026-09-14T01:10:00.000Z' })).toBe('13 Sep 2026 23:30 – 14 Sep 2026 01:10 UTC'));
  it('does not depend on the browser time zone: an instant near midnight stays on its UTC day', () => expect(windowLabel({ from: '2026-09-13T00:05:00.000Z', to: '2026-09-13T00:50:00.000Z' })).toBe('13 Sep 2026, 00:05–00:50 UTC'));
  it('says so when nothing is loaded', () => expect(windowLabel(null)).toBe('no readings loaded'));
});

describe('count', () => {
  it.each([[4200, '4,200'], [21, '21'], [0, '0'], [1234567, '1,234,567']])('%s -> %s', (n, e) => expect(count(n)).toBe(e));
});

describe('atLabel', () => {
  it('one instant in UTC', () => expect(atLabel('2026-09-13T11:14:00.000Z')).toBe('13 Sep 2026, 11:14 UTC'));
  it('pads hours and minutes', () => expect(atLabel('2026-01-05T03:07:00.000Z')).toBe('5 Jan 2026, 03:07 UTC'));
});

describe('labels', () => {
  it('avgLabel', () => { expect(avgLabel(22.46, '°C')).toBe('22.5 °C'); expect(avgLabel(null, '%')).toBe('—'); });
  it('every state has a label', () => expect(Object.keys(STATE_LABEL).sort()).toEqual(['alert', 'no_data', 'normal', 'warning']));
});
