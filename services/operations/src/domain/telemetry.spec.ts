import { buildTelemetrySummary, DeviceRow, severityOf, TelemetryInput } from './telemetry';

const dev = (id: string, location: string, readingKind: string, over: Partial<DeviceRow> = {}): DeviceRow => ({
  id, name: `${readingKind}_${id}`, kind: 'Sensor', location, vlan: 'VLAN 10', ipAddress: '192.168.10.1', macAddress: '0001.0001.0001', connection: 'ONLINE', readingKind, unit: 'X', ...over,
});
const at = (m: number) => new Date(Date.UTC(2026, 8, 13, 8, m));
const NOW = new Date('2026-10-25T12:00:00Z');

const base = (): TelemetryInput => ({
  devices: [dev('A1', 'Oficina 1', 'TEMP'), dev('A2', 'Oficina 1', 'HUMIDITY'), dev('B1', 'Oficina 2', 'TEMP'), dev('B2', 'Oficina 2', 'SMOKE')],
  latest: [
    { deviceId: 'A1', recordedAt: at(10), status: 'WARNING', value: 24, unit: '°C', note: 'Umbral' },
    { deviceId: 'A2', recordedAt: at(10), status: 'NORMAL', value: 50, unit: '%', note: 'ok' },
    { deviceId: 'B1', recordedAt: at(10), status: 'NORMAL', value: 22, unit: '°C', note: 'ok' },
    { deviceId: 'B2', recordedAt: at(10), status: 'ALERT', value: 1.2, unit: 'PPM', note: 'Humo' },
  ],
  statusCounts: [{ status: 'NORMAL', count: 30 }, { status: 'ACTIVE', count: 5 }, { status: 'WARNING', count: 3 }, { status: 'ALERT', count: 1 }],
  perDevice: [{ deviceId: 'A1', warnings: 3, alerts: 0 }, { deviceId: 'B2', warnings: 0, alerts: 1 }],
  averages: [{ location: 'Oficina 1', readingKind: 'TEMP', avg: 22.46 }, { location: 'Oficina 1', readingKind: 'HUMIDITY', avg: 49.94 }, { location: 'Oficina 2', readingKind: 'TEMP', avg: 21 }],
  attention: [{ recordedAt: at(10), deviceId: 'B2', status: 'ALERT', value: 1.2, unit: 'PPM', note: 'Humo' }, { recordedAt: at(9), deviceId: 'A1', status: 'WARNING', value: 24, unit: '°C', note: 'Umbral' }],
  window: { from: at(1), to: at(10) },
});

describe('severityOf', () => {
  it.each([['ALERT', 'alert'], ['WARNING', 'warning'], ['NORMAL', 'normal'], ['ACTIVE', 'normal'], ['LOCKED', 'normal'], ['DETECTED', 'normal'], ['anything else', 'normal']])('%s -> %s', (s, e) => expect(severityOf(s)).toBe(e));
  it('is case-sensitive: the source always writes upper case', () => expect(severityOf('alert')).toBe('normal'));
});

describe('buildTelemetrySummary', () => {
  it('counts devices, online devices and readings by severity', () => {
    const s = buildTelemetrySummary(base(), NOW);
    expect(s.totals).toEqual({ devices: 4, online: 4, readings: 39, normal: 35, warnings: 3, alerts: 1 });
  });

  it('an offline device is not counted as online', () => {
    const i = base(); i.devices[0] = dev('A1', 'Oficina 1', 'TEMP', { connection: 'OFFLINE' });
    expect(buildTelemetrySummary(i, NOW).totals.online).toBe(3);
  });

  it('the state of a device comes from its LATEST reading, and alerts sort first', () => {
    const s = buildTelemetrySummary(base(), NOW);
    expect(s.devices.map((d) => [d.id, d.state])).toEqual([['B2', 'alert'], ['A1', 'warning'], ['A2', 'normal'], ['B1', 'normal']]);
    const a1 = s.devices.find((d) => d.id === 'A1')!;
    expect(a1).toMatchObject({ lastValue: 24, lastStatus: 'WARNING', lastAt: at(10).toISOString(), warnings: 3, alerts: 0 });
  });

  it('a device with no readings is «no_data» and keeps its zero counters', () => {
    const i = base(); i.latest = i.latest.filter((l) => l.deviceId !== 'B1');
    const b1 = buildTelemetrySummary(i, NOW).devices.find((d) => d.id === 'B1')!;
    expect(b1).toMatchObject({ state: 'no_data', lastValue: null, lastStatus: null, lastAt: null, warnings: 0, alerts: 0 });
  });

  it('groups by location with per-location counters and rounded averages', () => {
    const s = buildTelemetrySummary(base(), NOW);
    expect(s.byLocation).toEqual([
      { location: 'Oficina 1', devices: 2, warnings: 3, alerts: 0, avgTempC: 22.5, avgHumidityPct: 49.9 },
      { location: 'Oficina 2', devices: 2, warnings: 0, alerts: 1, avgTempC: 21, avgHumidityPct: null },
    ]);
  });

  it('the attention list names the device and keeps the order it came in', () => {
    const s = buildTelemetrySummary(base(), NOW);
    expect(s.attention.map((a) => [a.deviceId, a.deviceName, a.location, a.status])).toEqual([['B2', 'SMOKE_B2', 'Oficina 2', 'ALERT'], ['A1', 'TEMP_A1', 'Oficina 1', 'WARNING']]);
    expect(s.attention[0].at).toBe(at(10).toISOString());
  });

  it('exposes the time window of the data and the moment it was built', () => {
    const s = buildTelemetrySummary(base(), NOW);
    expect(s.window).toEqual({ from: at(1).toISOString(), to: at(10).toISOString() });
    expect(s.asOf).toBe(NOW.toISOString());
  });

  it('with nothing loaded everything is zero and the window is null', () => {
    const s = buildTelemetrySummary({ devices: [], latest: [], statusCounts: [], perDevice: [], averages: [], attention: [], window: null }, NOW);
    expect(s).toEqual({ asOf: NOW.toISOString(), window: null, totals: { devices: 0, online: 0, readings: 0, normal: 0, warnings: 0, alerts: 0 }, devices: [], byLocation: [], attention: [] });
  });

  it('does not mutate its input', () => {
    const i = base(); const copy = JSON.stringify(i);
    buildTelemetrySummary(i, NOW);
    expect(JSON.stringify(i)).toBe(copy);
  });
});
