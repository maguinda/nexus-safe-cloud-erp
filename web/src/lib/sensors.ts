import type { LineMarker, LineSeries, BarCategory, BarSeries, DonutSlice, HeatLine } from '../charts';
import { formatClock, formatNumber } from '../charts/format';
import type { Lang } from '../i18n/core';
import type { Insight, ReadingsQuery, Severity, TelemetryFacets, Trends, TrendsInsightCode } from './types';

/** Lo que se puede filtrar en la pantalla «Sensores». Vacío = sin filtro. Lo que se elige sale SIEMPRE de `facets`, nunca se escribe a mano. */
export interface SensorFilters {
  location: string;
  deviceKind: string;
  severity: '' | Severity;
  status: string;
  /** Hora UTC «HH:MM» dentro de la ventana de datos. */
  from: string;
  to: string;
}
export const EMPTY_FILTERS: SensorFilters = { location: '', deviceKind: '', severity: '', status: '', from: '', to: '' };

export type SortKey = NonNullable<ReadingsQuery['sort']>;
export const PAGE_SIZES = [25, 50, 100] as const;
export interface ExplorerState { filters: SensorFilters; sort: SortKey; order: 'asc' | 'desc'; page: number; pageSize: number }
export const INITIAL_STATE: ExplorerState = { filters: EMPTY_FILTERS, sort: 'at', order: 'desc', page: 0, pageSize: 50 };

export type ExplorerAction =
  | { type: 'set'; key: keyof SensorFilters; value: string }
  | { type: 'remove'; key: keyof SensorFilters }
  | { type: 'apply'; filters: Partial<SensorFilters> }
  | { type: 'clear' }
  | { type: 'sort'; key: SortKey }
  | { type: 'page'; page: number }
  | { type: 'pageSize'; size: number };

/** Orden con el que arranca cada columna cuando se elige: el tiempo y el valor, de mayor a menor; los nombres, de la A a la Z. */
export const DEFAULT_ORDER: Record<SortKey, 'asc' | 'desc'> = { at: 'desc', value: 'desc', status: 'asc', device: 'asc' };

const hhmm = (s: string) => (/^\d{2}:\d{2}$/.test(s) ? s : '');

/** «Desde» no puede pasar de «hasta»: si se cruzan, el que se tocó arrastra al otro (así nunca queda un rango vacío por error). */
function normalizeRange(f: SensorFilters, touched: 'from' | 'to' | null): SensorFilters {
  if (f.from && f.to && f.from > f.to) return touched === 'from' ? { ...f, to: f.from } : { ...f, from: f.to };
  return f;
}

/** Reductor de los filtros, el orden y la página: toda acción que cambia lo que se pide vuelve a la página 1. */
export function explorerReducer(state: ExplorerState, a: ExplorerAction): ExplorerState {
  switch (a.type) {
    case 'set': {
      const value = a.key === 'from' || a.key === 'to' ? hhmm(a.value) : a.value;
      return { ...state, page: 0, filters: normalizeRange({ ...state.filters, [a.key]: value } as SensorFilters, a.key === 'from' ? 'from' : a.key === 'to' ? 'to' : null) };
    }
    case 'remove': return { ...state, page: 0, filters: { ...state.filters, [a.key]: '' } };
    case 'apply': return { ...state, page: 0, filters: normalizeRange({ ...EMPTY_FILTERS, ...a.filters }, null) };
    case 'clear': return INITIAL_STATE;
    case 'sort': return state.sort === a.key ? { ...state, page: 0, order: state.order === 'asc' ? 'desc' : 'asc' } : { ...state, page: 0, sort: a.key, order: DEFAULT_ORDER[a.key] };
    case 'page': return { ...state, page: Number.isFinite(a.page) ? Math.max(0, Math.trunc(a.page)) : 0 };
    case 'pageSize': return (PAGE_SIZES as readonly number[]).includes(a.size) ? { ...state, page: 0, pageSize: a.size } : state;
  }
}

/** ¿Hay algún filtro puesto? (el orden y la página no cuentan). */
export const hasFilters = (f: SensorFilters): boolean => Object.values(f).some((v) => v !== '');

/** Los filtros puestos, en el orden en que se muestran como chips quitables. */
export const FILTER_ORDER: (keyof SensorFilters)[] = ['location', 'deviceKind', 'severity', 'status', 'from', 'to'];
export const activeFilters = (f: SensorFilters): { key: keyof SensorFilters; value: string }[] => FILTER_ORDER.filter((k) => f[k] !== '').map((k) => ({ key: k, value: f[k] }));

export interface DataWindow { from: string; to: string }

/** Las horas «HH:MM» (UTC) que se pueden elegir: de cada `step` minutos, desde el que contiene el inicio de los datos hasta el que contiene el final. */
export function timeMarks(window: DataWindow | null, step = 10): string[] {
  if (!window) return [];
  const a = Date.parse(window.from), b = Date.parse(window.to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || !(step > 0)) return [];
  const ms = step * 60_000;
  const out: string[] = [];
  for (let t = Math.floor(a / ms) * ms; t <= b; t += ms) out.push(formatClock(t));
  return out;
}

/** Una hora «HH:MM» dentro de lo que cubren los datos: lo que se escribe fuera de la ventana se lleva al borde; lo que no es una hora queda vacío. */
export function clampTime(value: string, window: DataWindow | null): string {
  if (!hhmm(value)) return '';
  const marks = window ? [formatClock(Date.parse(window.from)), formatClock(Date.parse(window.to))] : [];
  if (marks.length !== 2 || marks.some((m) => m === '—')) return value;
  return value < marks[0] ? marks[0] : value > marks[1] ? marks[1] : value;
}

/** «2026-09-13T09:40:00Z» (inicio de ese minuto) o «…:59Z» (fin de ese minuto, para «hasta»). El día es el de los datos. */
export function markToIso(window: DataWindow, mark: string, edge: 'from' | 'to'): string | undefined {
  if (!hhmm(mark) || !Number.isFinite(Date.parse(window.from))) return undefined;
  return `${window.from.slice(0, 10)}T${mark}:${edge === 'to' ? '59' : '00'}Z`;
}

/** De los filtros, el orden y la página a la consulta que entiende `GET /telemetry/readings`. Lo vacío no se manda. */
export function toQuery(state: ExplorerState, window: DataWindow | null): ReadingsQuery {
  const f = state.filters;
  const q: ReadingsQuery = { sort: state.sort, order: state.order, limit: state.pageSize, offset: state.page * state.pageSize };
  if (f.location) q.location = f.location;
  if (f.deviceKind) q.deviceKind = f.deviceKind;
  if (f.severity) q.severity = f.severity;
  if (f.status) q.status = f.status;
  if (window) {
    const from = f.from ? markToIso(window, f.from, 'from') : undefined, to = f.to ? markToIso(window, f.to, 'to') : undefined;
    if (from) q.from = from;
    if (to) q.to = to;
  }
  return q;
}

/** Cuántas filas se ven y de qué página: «Mostrando 51–100 de 4.200» y «Página 2 de 84». */
export function pageInfo(total: number, offset: number, limit: number, shown: number): { first: number; last: number; page: number; pages: number } {
  const pages = total <= 0 || limit <= 0 ? 1 : Math.ceil(total / limit);
  const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
  return { first: shown > 0 ? offset + 1 : 0, last: shown > 0 ? offset + shown : 0, page: Math.min(page, pages), pages };
}

// ---------------------------------------------------------------- hallazgos → filtro

/** El filtro que enseña las lecturas que respaldan un hallazgo; null si no hay nada que ver (todo normal). */
export function insightFilter(i: Insight<TrendsInsightCode>, facets: TelemetryFacets | null): Partial<SensorFilters> | null {
  const clock = (iso: unknown) => (typeof iso === 'string' && Number.isFinite(Date.parse(iso)) ? formatClock(Date.parse(iso)) : '');
  switch (i.code) {
    case 'simultaneous_alerts': { const c = clock(i.params.at); return c ? { severity: 'alert', from: c, to: c } : { severity: 'alert' }; }
    case 'periodic_warnings': return { severity: 'warning', ...(facets?.deviceKinds.includes('Temperature Monitor') ? { deviceKind: 'Temperature Monitor' } : {}) };
    case 'warnings_everywhere': return { severity: 'warning' };
    case 'office_hotter': return { severity: 'warning', location: String(i.params.location ?? '') };
    case 'all_normal': return null;
    default: return null;
  }
}

/** Los números de un hallazgo, ya escritos para el idioma (hora en UTC, decimales con coma o punto) y listos para `t()`. */
export function insightParams(i: Insight<TrendsInsightCode>, lang: Lang): Record<string, string | number> {
  const p: Record<string, string | number> = { ...i.params };
  if (typeof p.at === 'string' && Number.isFinite(Date.parse(p.at))) p.time = formatClock(Date.parse(p.at));
  if (typeof p.value === 'number') p.value = formatNumber(p.value, lang, 1);
  if (typeof p.tempC === 'number') p.tempC = formatNumber(p.tempC, lang, 1);
  return p;
}

// ---------------------------------------------------------------- series de los gráficos

const visible = (all: string[], location: string): string[] => (location ? all.filter((l) => l === location) : all);
const ms = (iso: string) => Date.parse(iso);

type PointKey = 'avgTempC' | 'avgHumidityPct';
/** Una línea por oficina visible. La oficina «i» conserva su tono aunque se oculten otras (el tono sigue a la oficina, no a su posición). */
export function lineSeries(trends: Trends, key: PointKey, location: string): LineSeries[] {
  return trends.series.filter((s) => visible(trends.locations, location).includes(s.location)).map((s) => ({
    id: s.location, label: s.location, tone: (`chart-${trends.locations.indexOf(s.location) + 1}`) as LineSeries['tone'],
    points: s.points.map((p) => ({ x: ms(p.at), y: p[key] })),
  }));
}

/** Rombos sobre la temperatura en cada advertencia de las oficinas visibles (las alertas son de humo: no van en el eje de la temperatura). */
export function warningMarkers(trends: Trends, location: string, label: (e: Trends['events'][number]) => string): LineMarker[] {
  const show = visible(trends.locations, location);
  return trends.events.filter((e) => e.status === 'WARNING' && show.includes(e.location) && Number.isFinite(Date.parse(e.at))).map((e) => ({ x: ms(e.at), y: e.value, label: label(e), tone: 'warn' as const }));
}

/** Los tramos de 10 minutos que existen en los datos de las oficinas visibles, en orden. */
export function slots(trends: Trends, location: string): string[] {
  const show = visible(trends.locations, location);
  return [...new Set(trends.series.filter((s) => show.includes(s.location)).flatMap((s) => s.points.map((p) => p.at)))].sort();
}

/** Advertencias y alertas por tramo, sumadas sobre las oficinas visibles (para el gráfico de barras apiladas). */
export function slotBars(trends: Trends, location: string, labels: { warnings: string; alerts: string }): { categories: BarCategory[]; series: BarSeries[]; total: { warnings: number; alerts: number } } {
  const show = visible(trends.locations, location);
  const at = slots(trends, location);
  const sum = (k: 'warnings' | 'alerts') => at.map((t) => trends.series.filter((s) => show.includes(s.location)).reduce((n, s) => n + (s.points.find((p) => p.at === t)?.[k] ?? 0), 0));
  const w = sum('warnings'), a = sum('alerts');
  return {
    categories: at.map((t) => ({ id: t, label: formatClock(ms(t)), shortLabel: formatClock(ms(t)) })),
    series: [{ id: 'warnings', label: labels.warnings, tone: 'warn', values: w }, { id: 'alerts', label: labels.alerts, tone: 'bad', values: a }],
    total: { warnings: w.reduce((n, v) => n + v, 0), alerts: a.reduce((n, v) => n + v, 0) },
  };
}

/** Mapa de calor: una fila por oficina visible, una columna por tramo; el valor son las detecciones de movimiento (null si esa oficina no tiene ese tramo). */
export function motionHeat(trends: Trends, location: string): { rows: HeatLine[]; cols: HeatLine[]; values: (number | null)[][] } {
  const show = visible(trends.locations, location);
  const at = slots(trends, location);
  const rows = trends.series.filter((s) => show.includes(s.location));
  return {
    rows: rows.map((s) => ({ id: s.location, label: s.location })),
    cols: at.map((t) => ({ id: t, label: formatClock(ms(t)) })),
    values: rows.map((s) => at.map((t) => s.points.find((p) => p.at === t)?.motionDetections ?? null)),
  };
}

/** Lecturas por severidad (de `facets.statuses`): normal, advertencia y alerta, en ese orden y con su tono de estado. */
export function severitySlices(facets: TelemetryFacets, label: Record<Severity, string>): DonutSlice[] {
  const n: Record<Severity, number> = { normal: 0, warning: 0, alert: 0 };
  for (const s of facets.statuses) n[s.severity] += s.count;
  return ([['normal', 'ok'], ['warning', 'warn'], ['alert', 'bad']] as const).map(([k, tone]) => ({ id: k, label: label[k], value: n[k], tone })).filter((x) => x.value > 0);
}

// ---------------------------------------------------------------- tarjetas

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Temperatura media por tramo (promedio de las oficinas visibles; un tramo sin lecturas de temperatura se omite). */
export function meanTempBySlot(trends: Trends, location: string): number[] {
  const show = visible(trends.locations, location);
  return slots(trends, location).map((t) => mean(trends.series.filter((s) => show.includes(s.location)).map((s) => s.points.find((p) => p.at === t)?.avgTempC).filter(finite))).filter(finite);
}

/** Media de la primera y de la última media hora (3 tramos) para decir si la temperatura sube o baja; con pocos tramos, mitad y mitad. null si no hay con qué comparar. */
export function firstLast(values: number[]): { first: number; last: number } | null {
  if (values.length < 2) return null;
  const n = values.length >= 6 ? 3 : Math.floor(values.length / 2);
  const first = mean(values.slice(0, n)), last = mean(values.slice(values.length - n));
  return first === null || last === null ? null : { first, last };
}

/** % de lecturas de calefactor encendido: promedio de los tramos de las oficinas visibles. */
export function heaterOnPct(trends: Trends, location: string): number | null {
  const show = visible(trends.locations, location);
  return mean(trends.series.filter((s) => show.includes(s.location)).flatMap((s) => s.points.map((p) => p.heaterOnPct)).filter(finite));
}

export interface SensorCards {
  readings: number; normal: number; warnings: number; alerts: number;
  warningSharePct: number | null; tempPeak: number | null; threshold: number | null; meanTemp: number[]; trend: { first: number; last: number } | null; heater: number | null;
}
/** Las cifras de las tarjetas. Las lecturas de severidad vienen de `facets` (toda la fuente); lo demás, de las oficinas visibles. */
export function buildCards(trends: Trends, facets: TelemetryFacets, location: string): SensorCards {
  const bySev = (s: Severity) => facets.statuses.filter((x) => x.severity === s).reduce((n, x) => n + x.count, 0);
  const locs = trends.byLocation.filter((l) => !location || l.location === location);
  const tempReadings = locs.reduce((n, l) => n + l.tempReadings, 0), warnReadings = locs.reduce((n, l) => n + l.warningReadings, 0);
  const peaks = locs.map((l) => l.peakTempC).filter(finite);
  const meanTemp = meanTempBySlot(trends, location);
  return {
    readings: facets.statuses.reduce((n, x) => n + x.count, 0), normal: bySev('normal'), warnings: bySev('warning'), alerts: bySev('alert'),
    warningSharePct: tempReadings > 0 ? Math.round((warnReadings / tempReadings) * 1000) / 10 : null,
    tempPeak: peaks.length ? Math.max(...peaks) : null, threshold: trends.thresholds.tempWarningC,
    meanTemp, trend: firstLast(meanTemp), heater: heaterOnPct(trends, location),
  };
}

/** El filtro de «Ver detalle» de una tarjeta; null si la tarjeta no filtra nada. */
export function cardFilter(card: 'readings' | 'warnings' | 'alerts' | 'temperature' | 'heater', facets: TelemetryFacets | null): Partial<SensorFilters> | null {
  const kind = (k: string) => (facets?.deviceKinds.includes(k) ? { deviceKind: k } : null);
  switch (card) {
    case 'readings': return {};
    case 'warnings': return { severity: 'warning' };
    case 'alerts': return { severity: 'alert' };
    case 'temperature': return kind('Temperature Monitor');
    case 'heater': return kind('Heating Element');
  }
}
