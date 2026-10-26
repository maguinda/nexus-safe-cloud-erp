import { describe, expect, it } from 'vitest';
import { makeT, MESSAGES } from '../i18n';
import { avgLabel, num1, readingLabel, STATE_KEY, windowLabel } from './telemetry';

describe('num1', () => {
  it.each([[24, '24'], [22.46, '22.5'], [49.94, '49.9'], [0, '0'], [1.2, '1.2'], [30.0, '30']])('English: %s -> %s', (n, e) => expect(num1(n, 'en')).toBe(e));
  it.each([[24, '24'], [22.46, '22,5'], [49.94, '49,9'], [0, '0'], [1.2, '1,2'], [30.0, '30']])('Spanish uses a decimal comma: %s -> %s', (n, e) => expect(num1(n, 'es')).toBe(e));
  it('English is the default, as before', () => expect(num1(22.46)).toBe('22.5'));
});

describe('readingLabel', () => {
  it('shows value and unit', () => expect(readingLabel({ unit: '°C', lastValue: 24, lastStatus: 'WARNING' }, 'en')).toBe('24 °C'));
  it('keeps one decimal (point in English, comma in Spanish)', () => {
    expect(readingLabel({ unit: 'PPM', lastValue: 1.2, lastStatus: 'ALERT' }, 'en')).toBe('1.2 PPM');
    expect(readingLabel({ unit: 'PPM', lastValue: 1.2, lastStatus: 'ALERT' }, 'es')).toBe('1,2 PPM');
  });
  it('shows the raw status for yes/no signals, not 0 or 1, in both languages (it is data, it is not translated)', () => {
    for (const lang of ['en', 'es'] as const) {
      expect(readingLabel({ unit: 'BOOL', lastValue: 1, lastStatus: 'LOCKED' }, lang)).toBe('LOCKED');
      expect(readingLabel({ unit: 'BOOL', lastValue: 0, lastStatus: 'CLEAR' }, lang)).toBe('CLEAR');
    }
  });
  it('is a dash when there is no reading', () => expect(readingLabel({ unit: '°C', lastValue: null, lastStatus: null }, 'es')).toBe('—'));
  it('is a dash for a yes/no signal with no status', () => expect(readingLabel({ unit: 'BOOL', lastValue: 1, lastStatus: null }, 'en')).toBe('—'));
});

describe('windowLabel', () => {
  const day = { from: '2026-09-13T08:01:00.000Z', to: '2026-09-13T11:20:00.000Z' };
  const two = { from: '2026-09-13T23:30:00.000Z', to: '2026-09-14T01:10:00.000Z' };
  const edge = { from: '2026-09-13T00:05:00.000Z', to: '2026-09-13T00:50:00.000Z' };
  it('English, one day: date once, hours in UTC', () => expect(windowLabel(day, 'en')).toBe('13 Sep 2026, 08:01–11:20 UTC'));
  it('English, two days: both dates', () => expect(windowLabel(two, 'en')).toBe('13 Sep 2026 23:30 – 14 Sep 2026 01:10 UTC'));
  it('does not depend on the browser time zone: an instant near midnight stays on its UTC day', () => expect(windowLabel(edge, 'en')).toBe('13 Sep 2026, 00:05–00:50 UTC'));
  it('Spanish: lower-case month, same hours', () => {
    expect(windowLabel(day, 'es')).toBe('13 sep 2026, 08:01–11:20 UTC');
    expect(windowLabel(two, 'es')).toBe('13 sep 2026 23:30 – 14 sep 2026 01:10 UTC');
  });
  it('says so when nothing is loaded, in each language', () => { expect(windowLabel(null, 'en')).toBe('no readings loaded'); expect(windowLabel(null, 'es')).toBe('sin lecturas cargadas'); });
  it('English is the default, as before', () => expect(windowLabel(day)).toBe('13 Sep 2026, 08:01–11:20 UTC'));
});

describe('avgLabel', () => {
  it('English and Spanish decimals, and a dash for nothing', () => {
    expect(avgLabel(22.46, '°C', 'en')).toBe('22.5 °C');
    expect(avgLabel(22.46, '°C', 'es')).toBe('22,5 °C');
    expect(avgLabel(49.84, '%', 'es')).toBe('49,8 %');
    expect(avgLabel(null, '%', 'es')).toBe('—');
  });
});

describe('device states are names of the app, so they are translated', () => {
  it('every state has a key', () => expect(Object.keys(STATE_KEY).sort()).toEqual(['alert', 'no_data', 'normal', 'warning']));
  it('English names are the ones the screen always had', () => {
    const t = makeT('en');
    expect(Object.values(STATE_KEY).map((k) => t(k))).toEqual(['Normal', 'Warning', 'Alert', 'No data']);
  });
  it('Spanish names', () => {
    const t = makeT('es');
    expect(Object.values(STATE_KEY).map((k) => t(k))).toEqual(['Normal', 'Advertencia', 'Alerta', 'Sin datos']);
  });
  it('the keys exist in both dictionaries', () => { for (const k of Object.values(STATE_KEY)) { expect(MESSAGES.es[k]).toBeTruthy(); expect(MESSAGES.en[k]).toBeTruthy(); } });
});
