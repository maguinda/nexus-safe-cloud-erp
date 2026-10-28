import { severityOf, StatusCount } from './telemetry';

/**
 * Rangos que la persona puede ver. El "ahora" es la lectura MÁS RECIENTE guardada (los datos pueden venir en tiempo virtual, no del reloj), y el tramo
 * se ensancha con el rango para que la respuesta no crezca con el tiempo: como máximo ~145 puntos por oficina.
 */
export const RANGES = {
  '1d': { hours: 24, bucketMinutes: 10 },
  '7d': { hours: 24 * 7, bucketMinutes: 120 },
  '30d': { hours: 24 * 30, bucketMinutes: 360 },
  '180d': { hours: 24 * 180, bucketMinutes: 2880 },
  '365d': { hours: 24 * 365, bucketMinutes: 5760 },
} as const;
export type RangeKey = keyof typeof RANGES;
export const DEFAULT_RANGE: RangeKey = '1d';
export const isRangeKey = (v: unknown): v is RangeKey => typeof v === 'string' && Object.prototype.hasOwnProperty.call(RANGES, v);
/** Los hallazgos se calculan con los eventos más recientes del rango (tope); a la pantalla llegan los últimos EVENTS_SHOWN y el total real. */
export const EVENTS_FOR_INSIGHTS = 5000;
export const EVENTS_SHOWN = 300;

export interface RangeSpec { key: RangeKey; from: Date; to: Date; bucketMinutes: number }
/** El rango que termina en la lectura más reciente. */
export function rangeFor(key: RangeKey, latest: Date): RangeSpec {
  const { hours, bucketMinutes } = RANGES[key];
  return { key, from: new Date(latest.getTime() - hours * 3_600_000), to: latest, bucketMinutes };
}

const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);
const SEVERITY_ORDER = ['high', 'medium', 'info'];

export interface BucketRow {
  location: string; bucket: Date;
  avgTempC: number | null; maxTempC: number | null; avgHumidityPct: number | null; maxSmokePpm: number | null; heaterOnPct: number | null;
  detections: number; unlocks: number; warnings: number; alerts: number;
}
export interface LocationStat { location: string; tempReadings: number; warningReadings: number; peakTempC: number | null; heaterReadings: number; heaterOn: number }
export interface EventRow { recordedAt: Date; deviceName: string; location: string; status: string; value: number; unit: string; note: string | null }

/** Lo que el repositorio entrega ya agregado: tramos por oficina (de lo que mida el rango), contadores por oficina y solo los eventos ALERT/WARNING. */
export interface TrendsInput {
  /** Todo lo guardado (primera y última lectura). */
  window: { from: Date; to: Date } | null;
  /** El rango pedido (null si no hay datos). Todo lo demás de este objeto son números de ESE rango. */
  range: RangeSpec | null;
  /** Cuántos eventos ALERT/WARNING hay en el rango (los de `events` son, como mucho, los más recientes). */
  eventsTotal: number;
  statusCounts: StatusCount[];
  /** Desde qué temperatura la fuente marca WARNING (la menor de las lecturas de temperatura en WARNING); null si no hay ninguna. */
  tempWarningC: number | null;
  buckets: BucketRow[];
  perLocation: LocationStat[];
  events: EventRow[];
}

export type InsightCode = 'simultaneous_alerts' | 'periodic_warnings' | 'warnings_everywhere' | 'office_hotter' | 'all_normal';
/** Un hallazgo: qué regla lo detectó y los números para decirlo. El texto lo arma la pantalla en el idioma de la persona. */
export interface Insight { code: InsightCode; severity: 'high' | 'medium' | 'info'; params: Record<string, string | number> }

export interface Trends {
  asOf: string; bucketMinutes: number;
  window: { from: string; to: string } | null;
  range: { key: RangeKey; from: string; to: string } | null;
  /** Lecturas del rango por estado, con su severidad. */
  statusCounts: { status: string; severity: 'normal' | 'warning' | 'alert'; count: number }[];
  eventsTotal: number;
  thresholds: { tempWarningC: number | null };
  locations: string[];
  series: { location: string; points: { at: string; avgTempC: number | null; maxTempC: number | null; avgHumidityPct: number | null; maxSmokePpm: number | null; heaterOnPct: number | null; motionDetections: number; doorUnlocks: number; warnings: number; alerts: number }[] }[];
  /** `heaterOnPct` sale de las lecturas reales del calefactor (con 10 minutos por tramo, promediar los porcentajes de los tramos da otro número). */
  byLocation: { location: string; tempReadings: number; warningReadings: number; warningSharePct: number; peakTempC: number | null; heaterReadings: number; heaterOnPct: number | null }[];
  events: { at: string; location: string; deviceName: string; status: string; value: number; unit: string; note: string | null }[];
  insights: Insight[];
}

/** Hallazgo: alertas de la MISMA hora en 2 o más oficinas (una causa común, una prueba o un error de configuración). */
function simultaneousAlerts(events: EventRow[]): Insight[] {
  const byInstant = new Map<number, EventRow[]>();
  for (const e of events.filter((x) => x.status === 'ALERT')) byInstant.set(e.recordedAt.getTime(), [...(byInstant.get(e.recordedAt.getTime()) ?? []), e]);
  const out: Insight[] = [];
  for (const [ms, group] of [...byInstant].sort((a, b) => a[0] - b[0])) {
    const locations = [...new Set(group.map((g) => g.location))].sort((a, b) => a.localeCompare(b));
    if (locations.length >= 2) out.push({ code: 'simultaneous_alerts', severity: 'high', params: { at: new Date(ms).toISOString(), locations: locations.length, names: locations.join(', '), devices: group.map((g) => g.deviceName).sort((a, b) => a.localeCompare(b)).join(', '), value: group[0].value, unit: group[0].unit } });
  }
  return out;
}

/** Hallazgo: las advertencias de un dispositivo se repiten con el mismo intervalo (al menos 3 y el 70 % de los intervalos iguales); dice cuántos dispositivos siguen el mismo patrón. */
function periodicWarnings(events: EventRow[]): Insight[] {
  const byDevice = new Map<string, number[]>();
  for (const e of events.filter((x) => x.status === 'WARNING')) byDevice.set(e.deviceName, [...(byDevice.get(e.deviceName) ?? []), e.recordedAt.getTime()]);
  const periodic: { device: string; minutes: number; count: number }[] = [];
  for (const [device, times] of byDevice) {
    const t = [...times].sort((a, b) => a - b);
    if (t.length < 3) continue;
    const gaps = t.slice(1).map((x, i) => Math.round((x - t[i]) / 60_000));
    const freq = new Map<number, number>(); for (const g of gaps) freq.set(g, (freq.get(g) ?? 0) + 1);
    const [gap, n] = [...freq].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (n / gaps.length >= 0.7) periodic.push({ device, minutes: gap, count: t.length });
  }
  if (periodic.length === 0) return [];
  const best = [...periodic].sort((a, b) => b.count - a.count || a.device.localeCompare(b.device))[0];
  return [{ code: 'periodic_warnings', severity: 'medium', params: { device: best.device, minutes: best.minutes, count: best.count, devices: periodic.filter((p) => p.minutes === best.minutes).length } }];
}

/** Hallazgo: ¿las advertencias son de una oficina o de todo el edificio? */
function whereWarnings(perLocation: LocationStat[], tempC: number | null): Insight[] {
  const withWarnings = perLocation.filter((p) => p.warningReadings > 0);
  if (withWarnings.length === 0) return [];
  const max = Math.max(...withWarnings.map((p) => p.warningReadings)); const min = Math.min(...withWarnings.map((p) => p.warningReadings));
  const total = withWarnings.reduce((n, p) => n + p.warningReadings, 0);
  if (withWarnings.length >= 2 && withWarnings.length === perLocation.length && max <= min * 1.25) return [{ code: 'warnings_everywhere', severity: 'medium', params: { locations: withWarnings.length, total, tempC: tempC ?? 0 } }];
  const top = [...withWarnings].sort((a, b) => b.warningReadings - a.warningReadings || a.location.localeCompare(b.location))[0];
  return [{ code: 'office_hotter', severity: 'medium', params: { location: top.location, warnings: top.warningReadings, total } }];
}

/** Función pura: de los agregados del repositorio a las tendencias de los sensores y sus hallazgos. */
export function buildTrends(input: TrendsInput, now: Date): Trends {
  const locations = [...new Set([...input.buckets.map((b) => b.location), ...input.perLocation.map((p) => p.location)])].sort((a, b) => a.localeCompare(b));
  const series = locations.map((location) => ({
    location,
    points: input.buckets.filter((b) => b.location === location).sort((a, b) => a.bucket.getTime() - b.bucket.getTime()).map((b) => ({
      at: b.bucket.toISOString(), avgTempC: round1(b.avgTempC), maxTempC: round1(b.maxTempC), avgHumidityPct: round1(b.avgHumidityPct), maxSmokePpm: round1(b.maxSmokePpm),
      heaterOnPct: round1(b.heaterOnPct), motionDetections: b.detections, doorUnlocks: b.unlocks, warnings: b.warnings, alerts: b.alerts,
    })),
  })).filter((s) => s.points.length > 0);
  const events = [...input.events].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || Number(a.status === 'WARNING') - Number(b.status === 'WARNING') || a.location.localeCompare(b.location) || a.deviceName.localeCompare(b.deviceName))
    .map((e) => ({ at: e.recordedAt.toISOString(), location: e.location, deviceName: e.deviceName, status: e.status, value: e.value, unit: e.unit, note: e.note })).slice(-EVENTS_SHOWN);
  const insights = [...simultaneousAlerts(input.events), ...periodicWarnings(input.events), ...whereWarnings(input.perLocation, input.tempWarningC)];
  if (insights.length === 0) insights.push({ code: 'all_normal', severity: 'info', params: {} });
  insights.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return {
    asOf: now.toISOString(), bucketMinutes: input.range?.bucketMinutes ?? RANGES[DEFAULT_RANGE].bucketMinutes,
    window: input.window ? { from: input.window.from.toISOString(), to: input.window.to.toISOString() } : null,
    range: input.range ? { key: input.range.key, from: input.range.from.toISOString(), to: input.range.to.toISOString() } : null,
    statusCounts: input.statusCounts.map((s) => ({ status: s.status, severity: severityOf(s.status), count: s.count })).sort((a, b) => a.status.localeCompare(b.status)),
    eventsTotal: input.eventsTotal,
    thresholds: { tempWarningC: input.tempWarningC },
    locations, series,
    byLocation: [...input.perLocation].sort((a, b) => a.location.localeCompare(b.location)).map((p) => ({ location: p.location, tempReadings: p.tempReadings, warningReadings: p.warningReadings, warningSharePct: p.tempReadings === 0 ? 0 : Math.round((p.warningReadings / p.tempReadings) * 1000) / 10, peakTempC: round1(p.peakTempC), heaterReadings: p.heaterReadings, heaterOnPct: p.heaterReadings === 0 ? null : Math.round((p.heaterOn / p.heaterReadings) * 1000) / 10 })),
    events, insights,
  };
}
