import { describe, expect, it } from 'vitest';
import {
  activeFilters, clampTime, buildCards, cardFilter, EMPTY_FILTERS, explorerReducer, firstLast, hasFilters, heaterOnPct, INITIAL_STATE, insightFilter, insightParams, lineSeries, markToIso, meanTempBySlot,
  motionHeat, pageInfo, severitySlices, slotBars, slots, timeMarks, toQuery, warningMarkers, type ExplorerState,
} from './sensors';
import type { Insight, TelemetryFacets, TrendPoint, Trends, TrendsInsightCode } from './types';

const WINDOW = { from: '2026-09-13T08:01:00.000Z', to: '2026-09-13T11:20:00.000Z' };
const at = (h: number, m: number) => new Date(Date.UTC(2026, 8, 13, h, m)).toISOString();
const pt = (h: number, m: number, o: Partial<TrendPoint> = {}): TrendPoint => ({ at: at(h, m), avgTempC: 22, maxTempC: 23, avgHumidityPct: 50, maxSmokePpm: 0, heaterOnPct: 90, motionDetections: 0, doorUnlocks: 0, warnings: 0, alerts: 0, ...o });
const series = (location: string, over: (i: number) => Partial<TrendPoint> = () => ({})) => ({ location, points: [0, 10, 20, 30, 40, 50].map((m, i) => pt(8, m, over(i))) });
const trends = (): Trends => ({
  asOf: '2026-10-26T00:00:00Z', bucketMinutes: 10, window: WINDOW, thresholds: { tempWarningC: 24 }, locations: ['Oficina 1', 'Oficina 2', 'Oficina 3'],
  series: [
    series('Oficina 1', (i) => ({ avgTempC: 21 + i * 0.5, warnings: i === 2 ? 1 : 0, alerts: i === 4 ? 1 : 0, motionDetections: i === 1 ? 3 : 0, heaterOnPct: 100 })),
    series('Oficina 2', (i) => ({ avgTempC: 22, warnings: i === 2 ? 2 : 0, alerts: i === 4 ? 1 : 0, motionDetections: i === 1 ? 1 : 0, heaterOnPct: 80 })),
    series('Oficina 3', (i) => ({ avgTempC: i === 0 ? null : 23, warnings: 0, alerts: i === 4 ? 1 : 0, heaterOnPct: null })),
  ],
  byLocation: [
    { location: 'Oficina 1', tempReadings: 200, warningReadings: 13, warningSharePct: 6.5, peakTempC: 24 },
    { location: 'Oficina 2', tempReadings: 200, warningReadings: 13, warningSharePct: 6.5, peakTempC: 23.5 },
    { location: 'Oficina 3', tempReadings: 200, warningReadings: 13, warningSharePct: 6.5, peakTempC: null },
  ],
  events: [
    { at: at(8, 14), location: 'Oficina 1', deviceName: 'TEMP_MON_OF1', status: 'WARNING', value: 24, unit: '°C', note: 'Umbral Ligero Superado' },
    { at: at(8, 20), location: 'Oficina 3', deviceName: 'TEMP_MON_OF3', status: 'WARNING', value: 24, unit: '°C', note: null },
    { at: at(8, 40), location: 'Oficina 1', deviceName: 'IoT10', status: 'ALERT', value: 1.2, unit: 'PPM', note: 'Alerta Humo Detectada' },
  ],
  insights: [],
});
const facets = (): TelemetryFacets => ({
  locations: ['Oficina 1', 'Oficina 2', 'Oficina 3'], deviceKinds: ['Heating Element', 'Temperature Monitor'], window: WINDOW,
  statuses: [{ status: 'NORMAL', severity: 'normal', count: 1758 }, { status: 'ACTIVE', severity: 'normal', count: 2400 }, { status: 'WARNING', severity: 'warning', count: 39 }, { status: 'ALERT', severity: 'alert', count: 3 }],
});
const insight = (code: TrendsInsightCode, params: Insight['params'] = {}): Insight<TrendsInsightCode> => ({ code, severity: 'high', params });
const run = (s: ExplorerState, ...actions: Parameters<typeof explorerReducer>[1][]) => actions.reduce(explorerReducer, s);

describe('explorerReducer: filtros, orden y página', () => {
  it('starts with no filter, newest first, 50 per page, page 1', () => {
    expect(INITIAL_STATE).toEqual({ filters: EMPTY_FILTERS, sort: 'at', order: 'desc', page: 0, pageSize: 50 });
    expect(hasFilters(INITIAL_STATE.filters)).toBe(false);
  });
  it('choosing a filter sets it and goes back to page 1', () => {
    const s = run({ ...INITIAL_STATE, page: 7 }, { type: 'set', key: 'location', value: 'Oficina 2' });
    expect(s.filters.location).toBe('Oficina 2'); expect(s.page).toBe(0); expect(hasFilters(s.filters)).toBe(true);
  });
  it('«clear» leaves exactly the initial state (filters, sort, page and page size)', () => {
    const s = run(INITIAL_STATE, { type: 'set', key: 'severity', value: 'alert' }, { type: 'sort', key: 'value' }, { type: 'pageSize', size: 100 }, { type: 'page', page: 3 }, { type: 'clear' });
    expect(s).toEqual(INITIAL_STATE);
  });
  it('removing one chip keeps the others', () => {
    const s = run(INITIAL_STATE, { type: 'set', key: 'location', value: 'Oficina 1' }, { type: 'set', key: 'severity', value: 'warning' }, { type: 'remove', key: 'location' });
    expect(s.filters).toEqual({ ...EMPTY_FILTERS, severity: 'warning' });
  });
  it('«apply» REPLACES the filters (a finding shows its own evidence, not what was there before)', () => {
    const s = run(INITIAL_STATE, { type: 'set', key: 'location', value: 'Oficina 1' }, { type: 'apply', filters: { severity: 'alert', from: '09:40', to: '09:40' } });
    expect(s.filters).toEqual({ ...EMPTY_FILTERS, severity: 'alert', from: '09:40', to: '09:40' }); expect(s.page).toBe(0);
  });
  it('a «from» later than «to» drags «to» along, and the other way round: never an empty range by mistake', () => {
    const a = run(INITIAL_STATE, { type: 'set', key: 'to', value: '09:00' }, { type: 'set', key: 'from', value: '10:00' });
    expect(a.filters).toMatchObject({ from: '10:00', to: '10:00' });
    const b = run(INITIAL_STATE, { type: 'set', key: 'from', value: '10:00' }, { type: 'set', key: 'to', value: '09:00' });
    expect(b.filters).toMatchObject({ from: '09:00', to: '09:00' });
  });
  it('a time that is not HH:MM is dropped', () => {
    for (const bad of ['9:40', '09:4', 'abc', '09:40:00', '']) expect(run(INITIAL_STATE, { type: 'set', key: 'from', value: bad }).filters.from).toBe('');
  });
  it('sorting: a new column starts in its own order, the same column flips, both go back to page 1', () => {
    const v = run({ ...INITIAL_STATE, page: 4 }, { type: 'sort', key: 'value' });
    expect([v.sort, v.order, v.page]).toEqual(['value', 'desc', 0]);
    expect(run(v, { type: 'sort', key: 'value' }).order).toBe('asc');
    expect(run(v, { type: 'sort', key: 'value' }, { type: 'sort', key: 'value' }).order).toBe('desc');
    const d = run(INITIAL_STATE, { type: 'sort', key: 'device' }); expect([d.sort, d.order]).toEqual(['device', 'asc']);
    expect(run(d, { type: 'sort', key: 'at' }).order).toBe('desc');
  });
  it('the page never goes below 1 and ignores nonsense', () => {
    expect(run(INITIAL_STATE, { type: 'page', page: -3 }).page).toBe(0);
    expect(run(INITIAL_STATE, { type: 'page', page: NaN }).page).toBe(0);
    expect(run(INITIAL_STATE, { type: 'page', page: 2.9 }).page).toBe(2);
  });
  it('page size only takes 25, 50 or 100', () => {
    expect(run(INITIAL_STATE, { type: 'pageSize', size: 25 }).pageSize).toBe(25);
    for (const bad of [0, 10, 201, 1e6, NaN]) expect(run(INITIAL_STATE, { type: 'pageSize', size: bad }).pageSize).toBe(50);
  });
  it('does not mutate the state it receives', () => {
    const before = JSON.stringify(INITIAL_STATE);
    run(INITIAL_STATE, { type: 'set', key: 'location', value: 'x' }, { type: 'sort', key: 'value' }, { type: 'clear' });
    expect(JSON.stringify(INITIAL_STATE)).toBe(before); expect(EMPTY_FILTERS).toEqual({ location: '', deviceKind: '', severity: '', status: '', from: '', to: '' });
  });
  it('active filters come as chips in a fixed order', () => {
    expect(activeFilters({ ...EMPTY_FILTERS, to: '10:00', location: 'Oficina 1', severity: 'alert' }).map((c) => c.key)).toEqual(['location', 'severity', 'to']);
    expect(activeFilters(EMPTY_FILTERS)).toEqual([]);
  });
});

describe('time marks and the query', () => {
  it('marks every 10 minutes from the slot that holds the start to the end of the window (21 marks for 08:01–11:20)', () => {
    const m = timeMarks(WINDOW); expect(m).toHaveLength(21); expect(m[0]).toBe('08:00'); expect(m[1]).toBe('08:10'); expect(m[20]).toBe('11:20');
  });
  it('no window, a reversed window or garbage give no marks', () => {
    expect(timeMarks(null)).toEqual([]); expect(timeMarks({ from: WINDOW.to, to: WINDOW.from })).toEqual([]); expect(timeMarks({ from: 'x', to: 'y' })).toEqual([]); expect(timeMarks(WINDOW, 0)).toEqual([]);
  });
  it('a one-minute window still has its slot', () => expect(timeMarks({ from: at(9, 40), to: at(9, 40) })).toEqual(['09:40']));
  it('marks become ISO instants of the data day: start of the minute for «from», end of it for «to»', () => {
    expect(markToIso(WINDOW, '09:40', 'from')).toBe('2026-09-13T09:40:00Z'); expect(markToIso(WINDOW, '09:40', 'to')).toBe('2026-09-13T09:40:59Z');
    expect(markToIso(WINDOW, 'nope', 'from')).toBeUndefined(); expect(markToIso({ from: 'x', to: 'y' }, '09:40', 'from')).toBeUndefined();
  });
  it('the query leaves out what is empty and carries sort, order, limit and offset', () => {
    expect(toQuery(INITIAL_STATE, WINDOW)).toEqual({ sort: 'at', order: 'desc', limit: 50, offset: 0 });
    const s = run(INITIAL_STATE, { type: 'set', key: 'location', value: 'Oficina 1' }, { type: 'set', key: 'severity', value: 'warning' }, { type: 'pageSize', size: 25 }, { type: 'page', page: 2 });
    expect(toQuery(s, WINDOW)).toEqual({ location: 'Oficina 1', severity: 'warning', sort: 'at', order: 'desc', limit: 25, offset: 50 });
  });
  it('the time range goes in as both ends of the minute, inside the data day', () => {
    const s = run(INITIAL_STATE, { type: 'apply', filters: { from: '09:40', to: '09:40' } });
    expect(toQuery(s, WINDOW)).toMatchObject({ from: '2026-09-13T09:40:00Z', to: '2026-09-13T09:40:59Z' });
    expect(toQuery(s, null).from).toBeUndefined();
  });
  it('page info: counts, first and last row and the number of pages', () => {
    expect(pageInfo(4200, 50, 50, 50)).toEqual({ first: 51, last: 100, page: 2, pages: 84 });
    expect(pageInfo(4200, 4150, 50, 50)).toEqual({ first: 4151, last: 4200, page: 84, pages: 84 });
    expect(pageInfo(0, 0, 50, 0)).toEqual({ first: 0, last: 0, page: 1, pages: 1 });
    expect(pageInfo(39, 25, 25, 14)).toEqual({ first: 26, last: 39, page: 2, pages: 2 });
    expect(pageInfo(10, 0, 0, 0).pages).toBe(1);
  });
});

describe('clampTime', () => {
  it('keeps a time inside the window, moves one outside to the edge, and drops what is not a time', () => {
    expect(clampTime('09:40', WINDOW)).toBe('09:40'); expect(clampTime('07:00', WINDOW)).toBe('08:01'); expect(clampTime('23:59', WINDOW)).toBe('11:20');
    expect(clampTime('08:01', WINDOW)).toBe('08:01'); expect(clampTime('11:20', WINDOW)).toBe('11:20');
    for (const bad of ['', '9:40', 'xx:yy', '09:40:10']) expect(clampTime(bad, WINDOW)).toBe('');
  });
  it('with no usable window the time is left as typed', () => { expect(clampTime('09:40', null)).toBe('09:40'); expect(clampTime('09:40', { from: 'x', to: 'y' })).toBe('09:40'); });
});

describe('from finding to filter', () => {
  it('simultaneous alerts: severity alert at that exact minute', () => expect(insightFilter(insight('simultaneous_alerts', { at: at(9, 40) }), facets())).toEqual({ severity: 'alert', from: '09:40', to: '09:40' }));
  it('…and without a usable time, at least all the alerts', () => expect(insightFilter(insight('simultaneous_alerts', { at: 'garbage' }), facets())).toEqual({ severity: 'alert' }));
  it('periodic warnings: warnings of the temperature monitors (only if that kind exists in the data)', () => {
    expect(insightFilter(insight('periodic_warnings'), facets())).toEqual({ severity: 'warning', deviceKind: 'Temperature Monitor' });
    expect(insightFilter(insight('periodic_warnings'), { ...facets(), deviceKinds: [] })).toEqual({ severity: 'warning' });
    expect(insightFilter(insight('periodic_warnings'), null)).toEqual({ severity: 'warning' });
  });
  it('warnings everywhere: all the warnings; one hotter office: its warnings', () => {
    expect(insightFilter(insight('warnings_everywhere'), facets())).toEqual({ severity: 'warning' });
    expect(insightFilter(insight('office_hotter', { location: 'Oficina 2' }), facets())).toEqual({ severity: 'warning', location: 'Oficina 2' });
  });
  it('all normal has nothing to show', () => expect(insightFilter(insight('all_normal'), facets())).toBeNull());
  it('an unknown code is not turned into a filter', () => expect(insightFilter({ code: 'brand_new' as TrendsInsightCode, severity: 'info', params: {} }, facets())).toBeNull());
  it('every filter a finding applies is accepted by the reducer and by the query', () => {
    for (const i of [insight('simultaneous_alerts', { at: at(9, 40) }), insight('periodic_warnings'), insight('warnings_everywhere'), insight('office_hotter', { location: 'Oficina 1' })]) {
      const f = insightFilter(i, facets())!;
      const s = run(INITIAL_STATE, { type: 'apply', filters: f });
      expect(hasFilters(s.filters)).toBe(true); expect(toQuery(s, WINDOW).limit).toBe(50);
    }
  });
  it('the numbers of a finding are written for the language: UTC time, comma or point decimals', () => {
    const p = { at: at(9, 40), value: 1.2, tempC: 24, locations: 3, names: 'Oficina 1, Oficina 2, Oficina 3', unit: 'PPM' };
    expect(insightParams(insight('simultaneous_alerts', p), 'es')).toMatchObject({ time: '09:40', value: '1,2', tempC: '24', locations: 3, unit: 'PPM' });
    expect(insightParams(insight('simultaneous_alerts', p), 'en')).toMatchObject({ time: '09:40', value: '1.2' });
    expect(insightParams(insight('office_hotter', { location: 'Oficina 1', warnings: 30 }), 'es')).toEqual({ location: 'Oficina 1', warnings: 30 });
  });
});

describe('series for the charts', () => {
  it('one line per office, x in UTC milliseconds, and a hole (null) where the office had no reading', () => {
    const l = lineSeries(trends(), 'avgTempC', '');
    expect(l.map((s) => s.id)).toEqual(['Oficina 1', 'Oficina 2', 'Oficina 3']);
    expect(l[0].points[0]).toEqual({ x: Date.parse(at(8, 0)), y: 21 });
    expect(l[2].points[0].y).toBeNull();
  });
  it('filtering an office hides the others but its color follows the OFFICE, not its position', () => {
    const only3 = lineSeries(trends(), 'avgTempC', 'Oficina 3');
    expect(only3).toHaveLength(1); expect(only3[0].tone).toBe('chart-3');
    expect(lineSeries(trends(), 'avgHumidityPct', 'Oficina 1')[0].tone).toBe('chart-1');
    expect(lineSeries(trends(), 'avgTempC', 'Oficina 9')).toEqual([]);
  });
  it('markers are only the temperature WARNINGS of the visible offices (the smoke alert is not on the temperature axis)', () => {
    const m = warningMarkers(trends(), '', (e) => `${e.deviceName} · ${e.location}`);
    expect(m.map((x) => x.label)).toEqual(['TEMP_MON_OF1 · Oficina 1', 'TEMP_MON_OF3 · Oficina 3']); expect(m[0]).toMatchObject({ x: Date.parse(at(8, 14)), y: 24, tone: 'warn' });
    expect(warningMarkers(trends(), 'Oficina 3', (e) => e.deviceName)).toHaveLength(1);
  });
  it('slots: the 10-minute slots of the visible offices, in order, with no repeats', () => {
    expect(slots(trends(), '')).toHaveLength(6); expect(slots(trends(), 'Oficina 2')).toHaveLength(6);
    expect(slots({ ...trends(), series: [], locations: [] }, '')).toEqual([]);
  });
  it('bars: warnings and alerts per slot, summed over the visible offices, stacked in their status tones', () => {
    const b = slotBars(trends(), '', { warnings: 'Advertencias', alerts: 'Alertas' });
    expect(b.categories).toHaveLength(6); expect(b.categories[0].label).toBe('08:00');
    expect(b.series.map((s) => [s.id, s.tone])).toEqual([['warnings', 'warn'], ['alerts', 'bad']]);
    expect(b.series[0].values).toEqual([0, 0, 3, 0, 0, 0]); expect(b.series[1].values).toEqual([0, 0, 0, 0, 3, 0]);
    expect(b.total).toEqual({ warnings: 3, alerts: 3 });
    expect(slotBars(trends(), 'Oficina 2', { warnings: 'w', alerts: 'a' }).total).toEqual({ warnings: 2, alerts: 1 });
  });
  it('heat map: a row per visible office, a column per slot, motion detections as values', () => {
    const h = motionHeat(trends(), '');
    expect(h.rows.map((r) => r.label)).toEqual(['Oficina 1', 'Oficina 2', 'Oficina 3']); expect(h.cols).toHaveLength(6);
    expect(h.values[0]).toEqual([0, 3, 0, 0, 0, 0]); expect(h.values[1][1]).toBe(1);
    expect(motionHeat(trends(), 'Oficina 1').rows).toHaveLength(1);
  });
  it('the heat map shows a missing slot as null, never as zero', () => {
    const t = trends(); t.series[1] = { location: 'Oficina 2', points: t.series[1].points.slice(0, 3) };
    expect(motionHeat(t, '').values[1].slice(3)).toEqual([null, null, null]);
  });
  it('the donut has the three severities in order (and drops the empty ones)', () => {
    const s = severitySlices(facets(), { normal: 'Normal', warning: 'Advertencia', alert: 'Alerta' });
    expect(s.map((x) => [x.id, x.value, x.tone])).toEqual([['normal', 4158, 'ok'], ['warning', 39, 'warn'], ['alert', 3, 'bad']]);
    expect(severitySlices({ ...facets(), statuses: [{ status: 'NORMAL', severity: 'normal', count: 5 }] }, { normal: 'N', warning: 'W', alert: 'A' }).map((x) => x.id)).toEqual(['normal']);
    expect(severitySlices({ ...facets(), statuses: [] }, { normal: 'N', warning: 'W', alert: 'A' })).toEqual([]);
  });
});

describe('cards', () => {
  it('numbers come from the whole source for severity and from the visible offices for the rest', () => {
    const c = buildCards(trends(), facets(), '');
    expect(c).toMatchObject({ readings: 4200, normal: 4158, warnings: 39, alerts: 3, warningSharePct: 6.5, tempPeak: 24, threshold: 24 });
    expect(c.heater).toBeCloseTo((100 * 6 + 80 * 6) / 12, 5);
  });
  it('one office: its own share, peak and heater', () => {
    const c = buildCards(trends(), facets(), 'Oficina 2');
    expect(c.tempPeak).toBe(23.5); expect(c.heater).toBe(80); expect(c.warningSharePct).toBe(6.5);
  });
  it('an office with no peak or no heater reading gives null, not zero', () => {
    const c = buildCards(trends(), facets(), 'Oficina 3');
    expect(c.tempPeak).toBeNull(); expect(c.heater).toBeNull();
  });
  it('with no temperature readings there is no share to compute', () => expect(buildCards({ ...trends(), byLocation: [] }, facets(), '').warningSharePct).toBeNull());
  it('without data at all nothing breaks', () => {
    const empty: Trends = { ...trends(), series: [], byLocation: [], locations: [], events: [], thresholds: { tempWarningC: null } };
    expect(buildCards(empty, { locations: [], deviceKinds: [], statuses: [], window: null }, '')).toEqual({ readings: 0, normal: 0, warnings: 0, alerts: 0, warningSharePct: null, tempPeak: null, threshold: null, meanTemp: [], trend: null, heater: null });
  });
  it('mean temperature per slot averages the offices that have a value (a null is left out)', () => {
    const m = meanTempBySlot(trends(), '');
    expect(m).toHaveLength(6); expect(m[0]).toBeCloseTo((21 + 22) / 2, 5); expect(m[1]).toBeCloseTo((21.5 + 22 + 23) / 3, 5);
  });
  it('trend: first half hour against the last one (3 slots each), halves when there are few slots, nothing with fewer than 2', () => {
    expect(firstLast([1, 2, 3, 10, 20, 30])).toEqual({ first: 2, last: 20 });
    expect(firstLast([1, 3, 5, 7])).toEqual({ first: 2, last: 6 });
    expect(firstLast([4, 8])).toEqual({ first: 4, last: 8 });
    expect(firstLast([5])).toBeNull(); expect(firstLast([])).toBeNull();
  });
  it('heater: average of the slots with a value; none when no slot has one', () => {
    expect(heaterOnPct({ ...trends(), series: [] }, '')).toBeNull();
    expect(heaterOnPct(trends(), 'Oficina 1')).toBe(100);
  });
  it('«Ver detalle» filters only where it makes sense (and only with kinds that exist)', () => {
    expect(cardFilter('readings', facets())).toEqual({}); expect(cardFilter('warnings', facets())).toEqual({ severity: 'warning' }); expect(cardFilter('alerts', facets())).toEqual({ severity: 'alert' });
    expect(cardFilter('temperature', facets())).toEqual({ deviceKind: 'Temperature Monitor' }); expect(cardFilter('heater', facets())).toEqual({ deviceKind: 'Heating Element' });
    expect(cardFilter('temperature', { ...facets(), deviceKinds: ['Heating Element'] })).toBeNull(); expect(cardFilter('heater', null)).toBeNull();
  });
});
