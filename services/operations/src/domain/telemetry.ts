export type Severity = 'normal' | 'warning' | 'alert';
export type DeviceState = Severity | 'no_data';

/** La fuente (Packet Tracer) siempre escribe el estado del sensor en mayúsculas: ALERT y WARNING son los únicos que piden atención. */
export function severityOf(status: string): Severity {
  return status === 'ALERT' ? 'alert' : status === 'WARNING' ? 'warning' : 'normal';
}

/** Estados que piden atención del gerente (la lista «attention» del resumen), de más grave a menos: las alertas van antes que las advertencias. */
export const ATTENTION_STATUSES = ['ALERT', 'WARNING'];

export interface DeviceRow {
  id: string; name: string; kind: string; location: string; vlan: string; ipAddress: string; macAddress: string;
  /** Estado de conexión del inventario (ONLINE u OFFLINE). */
  connection: string;
  /** TEMP, HUMIDITY, STREAM, SMOKE, DETECTION, POWER o STATE. */
  readingKind: string; unit: string;
}
export interface LatestReading { deviceId: string; recordedAt: Date; status: string; value: number; unit: string; note: string | null }
export interface StatusCount { status: string; count: number }
export interface DeviceCounters { deviceId: string; warnings: number; alerts: number }
export interface LocationAverage { location: string; readingKind: string; avg: number }
export interface AttentionReading { recordedAt: Date; deviceId: string; status: string; value: number; unit: string; note: string | null }

/** Lo que el repositorio entrega ya agregado: nunca se cargan las 4.200 lecturas en memoria para armar el tablero. */
export interface TelemetryInput {
  devices: DeviceRow[];
  /** Última lectura de cada dispositivo. */
  latest: LatestReading[];
  statusCounts: StatusCount[];
  perDevice: DeviceCounters[];
  averages: LocationAverage[];
  /** ALERT primero y luego WARNING; dentro de cada grupo, la más reciente primero. */
  attention: AttentionReading[];
  window: { from: Date; to: Date } | null;
}

export interface TelemetrySummary {
  asOf: string;
  window: { from: string; to: string } | null;
  totals: { devices: number; online: number; readings: number; normal: number; warnings: number; alerts: number };
  devices: {
    id: string; name: string; kind: string; location: string; readingKind: string; unit: string; connection: string;
    state: DeviceState; lastValue: number | null; lastStatus: string | null; lastAt: string | null; warnings: number; alerts: number;
  }[];
  byLocation: { location: string; devices: number; warnings: number; alerts: number; avgTempC: number | null; avgHumidityPct: number | null }[];
  attention: { at: string; deviceId: string; deviceName: string; location: string; status: string; value: number; unit: string; note: string | null }[];
}

const RANK: Record<DeviceState, number> = { alert: 0, warning: 1, no_data: 2, normal: 3 };
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Función pura: de los agregados del repositorio al resumen de telemetría. El estado de un dispositivo sale de su ÚLTIMA lectura;
 * los contadores de advertencias y alertas son históricos (toda la ventana de datos).
 */
export function buildTelemetrySummary(input: TelemetryInput, now: Date): TelemetrySummary {
  const latest = new Map(input.latest.map((l) => [l.deviceId, l]));
  const counters = new Map(input.perDevice.map((c) => [c.deviceId, c]));
  const byId = new Map(input.devices.map((d) => [d.id, d]));

  const totals = { devices: input.devices.length, online: input.devices.filter((d) => d.connection === 'ONLINE').length, readings: 0, normal: 0, warnings: 0, alerts: 0 };
  for (const s of input.statusCounts) {
    totals.readings += s.count;
    const sev = severityOf(s.status);
    if (sev === 'alert') totals.alerts += s.count; else if (sev === 'warning') totals.warnings += s.count; else totals.normal += s.count;
  }

  const devices = input.devices.map((d) => {
    const l = latest.get(d.id); const c = counters.get(d.id);
    return {
      id: d.id, name: d.name, kind: d.kind, location: d.location, readingKind: d.readingKind, unit: d.unit, connection: d.connection,
      state: (l ? severityOf(l.status) : 'no_data') as DeviceState,
      lastValue: l ? l.value : null, lastStatus: l ? l.status : null, lastAt: l ? l.recordedAt.toISOString() : null,
      warnings: c?.warnings ?? 0, alerts: c?.alerts ?? 0,
    };
  }).sort((a, b) => RANK[a.state] - RANK[b.state] || a.location.localeCompare(b.location) || a.id.localeCompare(b.id));

  const locations = [...new Set(input.devices.map((d) => d.location))].sort((a, b) => a.localeCompare(b));
  const avg = (location: string, kind: string) => { const a = input.averages.find((x) => x.location === location && x.readingKind === kind); return a ? round1(a.avg) : null; };
  const byLocation = locations.map((location) => {
    const inLoc = devices.filter((d) => d.location === location);
    return {
      location, devices: inLoc.length, warnings: inLoc.reduce((n, d) => n + d.warnings, 0), alerts: inLoc.reduce((n, d) => n + d.alerts, 0),
      avgTempC: avg(location, 'TEMP'), avgHumidityPct: avg(location, 'HUMIDITY'),
    };
  });

  const attention = input.attention.map((a) => {
    const d = byId.get(a.deviceId);
    return { at: a.recordedAt.toISOString(), deviceId: a.deviceId, deviceName: d?.name ?? a.deviceId, location: d?.location ?? '', status: a.status, value: a.value, unit: a.unit, note: a.note };
  });

  return { asOf: now.toISOString(), window: input.window ? { from: input.window.from.toISOString(), to: input.window.to.toISOString() } : null, totals, devices, byLocation, attention };
}
