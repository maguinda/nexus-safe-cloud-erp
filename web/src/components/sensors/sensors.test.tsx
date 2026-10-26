import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { makeT } from '../../i18n';
import { buildCards, EMPTY_FILTERS, INITIAL_STATE, type ExplorerState } from '../../lib/sensors';
import type { Insight, Page, ReadingItem, TelemetryFacets, TrendPoint, Trends, TrendsInsightCode } from '../../lib/types';
import { Cards } from './Cards';
import { Charts } from './Charts';
import { FilterBar } from './FilterBar';
import { Insights } from './Insights';
import { ReadingsTable, readingValue, type ReadingsLoad } from './ReadingsTable';

const WINDOW = { from: '2026-09-13T08:01:00.000Z', to: '2026-09-13T11:20:00.000Z' };
const es = makeT('es'), en = makeT('en');
const html = (el: React.ReactElement) => { const out = renderToStaticMarkup(el); expect(out).not.toMatch(/NaN|undefined|Infinity|\[object|\{[a-z]+\}/); return out; };
const count = (out: string, re: RegExp) => (out.match(re) ?? []).length;
const at = (m: number) => new Date(Date.UTC(2026, 8, 13, 8, m)).toISOString();
const point = (m: number, o: Partial<TrendPoint> = {}): TrendPoint => ({ at: at(m), avgTempC: 22 + m / 100, maxTempC: 23, avgHumidityPct: 50, maxSmokePpm: 0, heaterOnPct: 90, motionDetections: m === 10 ? 4 : 0, doorUnlocks: 0, warnings: m === 20 ? 1 : 0, alerts: m === 40 ? 1 : 0, ...o });
const trends = (): Trends => ({
  asOf: '2026-10-26T00:00:00Z', bucketMinutes: 10, window: WINDOW, thresholds: { tempWarningC: 24 }, locations: ['Oficina 1', 'Oficina 2'],
  series: ['Oficina 1', 'Oficina 2'].map((location) => ({ location, points: [0, 10, 20, 30, 40, 50].map((m) => point(m)) })),
  byLocation: [{ location: 'Oficina 1', tempReadings: 200, warningReadings: 13, warningSharePct: 6.5, peakTempC: 24, heaterReadings: 200, heaterOnPct: 100 }, { location: 'Oficina 2', tempReadings: 200, warningReadings: 13, warningSharePct: 6.5, peakTempC: 24, heaterReadings: 200, heaterOnPct: 80 }],
  events: [{ at: at(20), location: 'Oficina 1', deviceName: 'TEMP_MON_OF1', status: 'WARNING', value: 24, unit: '°C', note: 'Umbral Ligero Superado' }, { at: at(40), location: 'Oficina 2', deviceName: 'IoT10(1)', status: 'ALERT', value: 1.2, unit: 'PPM', note: 'Alerta Humo Detectada' }],
  insights: [],
});
const facets = (): TelemetryFacets => ({
  locations: ['Oficina 1', 'Oficina 2'], deviceKinds: ['Heating Element', 'Temperature Monitor'], window: WINDOW,
  statuses: [{ status: 'NORMAL', severity: 'normal', count: 4158 }, { status: 'WARNING', severity: 'warning', count: 39 }, { status: 'ALERT', severity: 'alert', count: 3 }],
});
const ins = (code: TrendsInsightCode, severity: Insight['severity'], params: Insight['params'] = {}): Insight<TrendsInsightCode> => ({ code, severity, params });
const REAL: Insight<TrendsInsightCode>[] = [
  ins('simultaneous_alerts', 'high', { at: '2026-09-13T09:40:00.000Z', locations: 3, names: 'Oficina 1, Oficina 2, Oficina 3', devices: 'IoT10, IoT10(1), IoT10(2)', value: 1.2, unit: 'PPM' }),
  ins('periodic_warnings', 'medium', { device: 'TEMP_MON_OF1', minutes: 15, count: 13, devices: 3 }),
  ins('warnings_everywhere', 'medium', { locations: 3, total: 39, tempC: 24 }),
];

describe('Insights', () => {
  const view = (lang: 'es' | 'en', list = REAL) => html(<Insights insights={list} facets={facets()} lang={lang} t={lang === 'es' ? es : en} onView={vi.fn()} />);
  it('Spanish: each finding says what, with the numbers (comma decimal, UTC time), how it was detected, and offers the readings', () => {
    const out = view('es');
    expect(out).toContain('Alertas a la misma hora en 3 oficinas');
    expect(out).toContain('A las 09:40 UTC'); expect(out).toContain('Oficina 1, Oficina 2, Oficina 3'); expect(out).toContain('IoT10, IoT10(1), IoT10(2)'); expect(out).toContain('1,2 PPM');
    expect(out).toContain('Las advertencias se repiten cada 15 minutos'); expect(out).toContain('el mismo ritmo se repite en 3 dispositivos en total');
    expect(out).toContain('39 advertencias de temperatura (desde 24 °C)');
    expect(count(out, /Cómo se detectó:/g)).toBe(3); expect(count(out, />Ver las lecturas</g)).toBe(3);
  });
  it('English: the same findings, point decimals', () => {
    const out = view('en');
    expect(out).toContain('Alerts at the same time in 3 offices'); expect(out).toContain('1.2 PPM'); expect(out).toContain('Warnings repeat every 15 minutes'); expect(out).toContain('How it was detected:'); expect(out).toContain('See the readings');
    expect(out).not.toContain('Alertas');
  });
  it('the priority is said with an icon AND words, never by color alone, and the high one carries its own style', () => {
    const out = view('es');
    expect(out).toContain('Prioridad alta'); expect(out).toContain('Prioridad media'); expect(out).toContain('aria-hidden="true">✕'); expect(out).toContain('aria-hidden="true">!');
  });
  it('one device repeating alone reads differently from several', () => {
    const one = view('es', [ins('periodic_warnings', 'medium', { device: 'TEMP_MON_OF1', minutes: 15, count: 13, devices: 1 })]);
    expect(one).not.toContain('se repite en'); expect(one).toContain('TEMP_MON_OF1 registró 13 advertencias');
  });
  it('«all normal» has nothing to show and no button; a finding the screen does not know is left out, not shown empty', () => {
    const out = view('es', [ins('all_normal', 'info'), { code: 'brand_new' as TrendsInsightCode, severity: 'high', params: {} }]);
    expect(out).toContain('Todo en orden'); expect(out).not.toContain('Ver las lecturas'); expect(count(out, /<li /g)).toBe(1);
  });
  it('the button names the finding for a screen reader', () => expect(view('es')).toContain('aria-label="Ver las lecturas de: Alertas a la misma hora en 3 oficinas"'));
  it('no findings at all is an empty list, not an error', () => expect(view('es', [])).toContain('Hallazgos'));
});

describe('Cards', () => {
  const view = (lang: 'es' | 'en', o: { location?: string; kinds?: string[]; heater?: boolean } = {}) => {
    const f = { ...facets(), deviceKinds: o.kinds ?? facets().deviceKinds };
    return html(<Cards cards={buildCards(trends(), f, o.location ?? '')} facets={f} location={o.location ?? ''} window={WINDOW} bucketMinutes={10} lang={lang} t={lang === 'es' ? es : en} onDetail={vi.fn()} />);
  };
  it('numbers with the thousands separator of the language and the context of each one', () => {
    const out = view('es');
    expect(out).toContain('4.200'); expect(out).toContain('4.158 en estado normal'); expect(out).toContain('6,5 % de las lecturas de temperatura'); expect(out).toContain('Máxima 24 °C · umbral 24 °C');
    expect(out).toContain('90 %'); expect(out).toContain('08:01–11:20'); expect(out).toContain('tramos de 10 minutos, en UTC');
    const e = view('en'); expect(e).toContain('4,200'); expect(e).toContain('6.5 % of the temperature readings'); expect(e).toContain('Peak 24 °C · threshold 24 °C');
  });
  it('«See detail» only where there is something to filter: 5 cards, 3 when the kinds of device are not there', () => {
    expect(count(view('es'), />Ver detalle</g)).toBe(5); expect(count(view('es', { kinds: [] }), />Ver detalle</g)).toBe(3);
    expect(view('es')).toContain('aria-label="Ver detalle: Alertas"');
  });
  it('the temperature card draws its mini line and its trend with the right direction (rising is bad)', () => {
    const out = view('es'); expect(out).toContain('role="img"'); expect(out).toContain('La temperatura media por tramo de 10 minutos va de');
  });
  it('one office says so in the heater card; an office with no heater reading shows a dash', () => {
    expect(view('es', { location: 'Oficina 2' })).toContain('promedio de Oficina 2');
    const t = trends(); t.byLocation = t.byLocation.map((b) => ({ ...b, heaterReadings: 0, heaterOnPct: null }));
    const out = html(<Cards cards={buildCards(t, facets(), '')} facets={facets()} location="" window={WINDOW} bucketMinutes={10} lang="es" t={es} onDetail={vi.fn()} />);
    expect(out).toContain('>—<');
  });
});

describe('FilterBar', () => {
  const view = (filters = EMPTY_FILTERS, lang: 'es' | 'en' = 'es') => html(<FilterBar filters={filters} facets={facets()} window={WINDOW} dispatch={vi.fn()} lang={lang} t={lang === 'es' ? es : en} />);
  it('offers the offices and severities of the data, the 21 time marks, and no active chips or clear button when nothing is chosen', () => {
    const out = view();
    expect(out).toContain('Oficina 1'); expect(out).toContain('Oficina 2'); expect(out).toContain('Advertencia'); expect(out).toContain('Alerta'); expect(count(out, /<option /g)).toBe(21);
    expect(out).not.toContain('Limpiar filtros'); expect(out).not.toContain('Filtros activos'); expect(out).toContain('noValidate');
  });
  it('a chosen filter is pressed, shows as a removable chip with its own name, and the clear button appears', () => {
    const out = view({ ...EMPTY_FILTERS, location: 'Oficina 2', severity: 'alert', from: '09:40', to: '09:40' });
    expect(count(out, /aria-pressed="true"/g)).toBe(2); expect(out).toContain('Filtros activos'); expect(out).toContain('Limpiar filtros');
    expect(out).toContain('aria-label="Quitar el filtro: Oficina: Oficina 2"'); expect(out).toContain('aria-label="Quitar el filtro: Severidad: Alerta"'); expect(out).toContain('aria-label="Quitar el filtro: Desde (UTC): 09:40"');
    expect(out).toContain('value="09:40"');
  });
  it('the less common filters (kind of device, status) are in a disclosure that opens by itself when one is set, and show the raw status codes with their counts', () => {
    expect(view()).not.toMatch(/<details[^>]* open/);
    const out = view({ ...EMPTY_FILTERS, deviceKind: 'Heating Element' });
    expect(out).toMatch(/<details[^>]* open/); expect(out).toContain('Temperature Monitor'); expect(out).toContain('WARNING'); expect(out).toContain('4.158');
  });
  it('English labels', () => { const out = view({ ...EMPTY_FILTERS, severity: 'warning' }, 'en'); expect(out).toContain('Filters'); expect(out).toContain('Clear filters'); expect(out).toContain('Remove the filter: Severity: Warning'); expect(out).not.toContain('Limpiar'); });
});

const reading = (o: Partial<ReadingItem> = {}): ReadingItem => ({ id: 1, at: '2026-09-13T09:40:00.000Z', deviceId: 'IOT-OF1-05', deviceName: 'IoT10', location: 'Oficina 1', deviceKind: 'Smoke Detector', readingKind: 'SMOKE', status: 'ALERT', severity: 'alert', value: 1.2, unit: 'PPM', note: 'Alerta Humo Detectada', ...o });
const ready = (items: ReadingItem[], total = items.length, offset = 0, limit = 50): ReadingsLoad => ({ status: 'ready', page: { total, limit, offset, items } as Page<ReadingItem> });
const table = (load: ReadingsLoad, state: ExplorerState = INITIAL_STATE, lang: 'es' | 'en' = 'es') => html(<ReadingsTable load={load} state={state} dispatch={vi.fn()} headingRef={{ current: null }} onRetry={vi.fn()} lang={lang} t={lang === 'es' ? es : en} />);

describe('ReadingsTable', () => {
  it('rows: the source data is shown AS IT IS (device, status code, note) next to the translated severity', () => {
    const out = table(ready([reading(), reading({ id: 2, status: 'WARNING', severity: 'warning', value: 24, unit: '°C', deviceName: 'TEMP_MON_OF1', note: null })]));
    expect(out).toContain('IoT10'); expect(out).toContain('IOT-OF1-05'); expect(out).toContain('Alerta Humo Detectada'); expect(out).toContain('>ALERT<'); expect(out).toContain('>WARNING<');
    expect(out).toContain('1,2 PPM'); expect(out).toContain('24 °C'); expect(out).toContain('13 sep 2026, 09:40 UTC'); expect(out).toContain('>—<'); // la nota que no existe
    expect(count(out, /<tr>/g)).toBe(3);
  });
  it('the phone view has a label on every cell but the first (the title)', () => {
    const out = table(ready([reading()]));
    for (const l of ['Oficina', 'Dispositivo', 'Tipo', 'Estado', 'Valor', 'Nota']) expect(out).toContain(`data-label="${l}"`);
    expect(out).not.toContain('data-label="Hora');
  });
  it('sortable columns say how they are sorted and have a named button; the others have no button', () => {
    const out = table(ready([reading()]));
    expect(out).toContain('aria-sort="descending"'); expect(count(out, /aria-sort="none"/g)).toBe(3); expect(out).toContain('aria-label="Ordenar por Hora (UTC)"'); expect(count(out, /<button[^>]*sortBtn/g)).toBe(4);
    expect(table(ready([reading()]), { ...INITIAL_STATE, sort: 'value', order: 'asc' })).toContain('aria-sort="ascending"');
  });
  it('a yes/no signal shows just the number (its meaning is in the status)', () => {
    expect(readingValue({ value: 1, unit: 'BOOL' }, 'es')).toBe('1'); expect(readingValue({ value: 22.46, unit: '°C' }, 'es')).toBe('22,5 °C'); expect(readingValue({ value: 22.46, unit: '°C' }, 'en')).toBe('22.5 °C');
  });
  it('count and page: «Showing 51–100 of 4,200», «Page 2 of 84», previous enabled and next enabled in the middle', () => {
    const items = Array.from({ length: 50 }, (_, i) => reading({ id: i + 1 }));
    const out = table(ready(items, 4200, 50), { ...INITIAL_STATE, page: 1 });
    expect(out).toContain('Mostrando 51–100 de 4.200'); expect(out).toContain('Página 2 de 84');
    expect(out).not.toMatch(/disabled[^>]*>Anterior/); expect(out).not.toMatch(/disabled[^>]*>Siguiente/);
    expect(table(ready(items, 4200, 50), { ...INITIAL_STATE, page: 1 }, 'en')).toContain('Showing 51–100 of 4,200');
  });
  it('first page has no «previous», last page has no «next»', () => {
    const items = Array.from({ length: 50 }, (_, i) => reading({ id: i + 1 }));
    expect(table(ready(items, 4200, 0))).toMatch(/disabled=""[^>]*>Anterior/);
    expect(table(ready(items.slice(0, 50), 4200, 4150), { ...INITIAL_STATE, page: 83 })).toMatch(/disabled=""[^>]*>Siguiente/);
  });
  it('page size: 25, 50 and 100, the current one pressed', () => {
    const out = table(ready([reading()]), { ...INITIAL_STATE, pageSize: 25 });
    expect(out).toMatch(/aria-pressed="true"[^>]*>25</); expect(out).toMatch(/aria-pressed="false"[^>]*>50</); expect(out).toMatch(/aria-pressed="false"[^>]*>100</);
  });
  it('loading, empty and error each have their own state; the error can be retried', () => {
    expect(table({ status: 'loading' })).toContain('Cargando las lecturas…');
    const empty = table(ready([], 0)); expect(empty).toContain('Ninguna lectura coincide con estos filtros.'); expect(empty).toContain('Prueba quitando algún filtro.'); expect(empty).not.toContain('<table');
    const err = table({ status: 'error', message: 'La solicitud falló (502).' }); expect(err).toContain('role="alert"'); expect(err).toContain('No pudimos cargar las lecturas.'); expect(err).toContain('Reintentar'); expect(err).toContain('La solicitud falló (502).');
  });
  it('the title can take the focus when a finding sends the person here', () => expect(table(ready([reading()]))).toMatch(/<h2[^>]*tabindex="-1"/));
});

describe('Charts', () => {
  const view = (o: { t?: Trends; f?: TelemetryFacets; location?: string; lang?: 'es' | 'en' } = {}) => html(<Charts trends={o.t ?? trends()} facets={o.f ?? facets()} location={o.location ?? ''} lang={o.lang ?? 'es'} t={(o.lang ?? 'es') === 'es' ? es : en} />);
  it('five charts, each an image with a summary that says the finding, and each with its table', () => {
    const out = view();
    expect(count(out, /role="img"/g)).toBeGreaterThanOrEqual(5); expect(count(out, /Ver como tabla/g)).toBe(5);
    expect(out).toContain('La temperatura media de las oficinas llega al umbral de 24 °C; advertencias marcadas: 1'); expect(out).toContain('Advertencias: 2; alertas: 2; tramos de 10 minutos: 6');
    expect(out).toContain('Lecturas normales: 4.158; advertencias: 39; alertas: 3'); expect(out).toContain('Detecciones de movimiento en total: 8; el máximo en un mismo tramo: 4');
  });
  it('the threshold is drawn with its label and the warning events are marked', () => { const out = view(); expect(out).toContain('Umbral 24 °C'); expect(out).toContain('Advertencia: TEMP_MON_OF1 (Oficina 1)'); });
  it('choosing an office leaves only its series (the other office is not in the charts)', () => {
    const out = view({ location: 'Oficina 2' });
    expect(out).not.toContain('Advertencia: TEMP_MON_OF1'); expect(out).toContain('Oficina 2');
  });
  it('English', () => { const out = view({ lang: 'en' }); expect(out).toContain('Temperature by office'); expect(out).toContain('Threshold 24 °C'); expect(out).toContain('View as table'); expect(out).not.toContain('Temperatura por oficina'); });
  it('with no series every chart says «no data» instead of drawing an empty frame', () => {
    const t = { ...trends(), series: [], locations: [], byLocation: [], events: [] };
    const out = view({ t, f: { ...facets(), statuses: [] } });
    expect(count(out, /Sin datos/g)).toBeGreaterThanOrEqual(5); expect(out).not.toContain('role="img"');
  });
  it('odd data does not break it: one point per office and no threshold', () => {
    const t = trends(); t.thresholds = { tempWarningC: null }; t.series = t.series.map((s) => ({ ...s, points: s.points.slice(0, 1) }));
    const out = view({ t }); expect(out).toContain('Temperatura media por oficina cada 10 minutos'); expect(out).not.toContain('Umbral');
  });
  it('a temperature that is null everywhere is «no data» for that chart, not an empty frame', () => {
    const t = trends(); t.series = t.series.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, avgTempC: null })) }));
    expect(view({ t })).toContain('Sin datos');
  });
  it('singular and plural never need a rule: the summaries say «Advertencias: 1», not «1 advertencias»', () => {
    const t = trends(); t.events = [t.events[0]]; const out = view({ t });
    expect(out).not.toMatch(/\b1 (advertencias|alertas|detecciones|dispositivos)/);
  });
});
