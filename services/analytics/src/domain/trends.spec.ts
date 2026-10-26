import { buildTrends, TrendsInput } from './trends';

const NOW = new Date('2026-10-26T12:00:00Z');
const at = (h: number, m: number) => new Date(Date.UTC(2026, 8, 13, h, m));
const bucket = (location: string, h: number, m: number, over: Partial<TrendsInput['buckets'][number]> = {}) => ({
  location, bucket: at(h, m), avgTempC: 22, maxTempC: 23, avgHumidityPct: 50, maxSmokePpm: 0, heaterOnPct: 100, detections: 0, unlocks: 0, warnings: 0, alerts: 0, ...over,
});
const ev = (h: number, m: number, location: string, status: string, over: Partial<TrendsInput['events'][number]> = {}) => ({
  recordedAt: at(h, m), deviceName: `${status === 'ALERT' ? 'IoT10' : 'TEMP_MON'}_${location.slice(-1)}`, location, status, value: status === 'ALERT' ? 1.2 : 24, unit: status === 'ALERT' ? 'PPM' : '°C', note: 'n', ...over,
});
const base = (): TrendsInput => ({
  window: { from: at(8, 1), to: at(11, 20) },
  tempWarningC: 24,
  buckets: [bucket('Oficina 2', 8, 10), bucket('Oficina 1', 8, 20), bucket('Oficina 1', 8, 10), bucket('Oficina 2', 8, 20)],
  perLocation: [
    { location: 'Oficina 1', tempReadings: 200, warningReadings: 13, peakTempC: 24, heaterReadings: 200, heaterOn: 180 },
    { location: 'Oficina 2', tempReadings: 200, warningReadings: 13, peakTempC: 24, heaterReadings: 200, heaterOn: 180 },
  ],
  events: [ev(9, 40, 'Oficina 1', 'ALERT'), ev(9, 40, 'Oficina 2', 'ALERT'), ev(8, 14, 'Oficina 1', 'WARNING'), ev(8, 29, 'Oficina 1', 'WARNING'), ev(8, 44, 'Oficina 1', 'WARNING'), ev(8, 59, 'Oficina 1', 'WARNING')],
});

describe('buildTrends', () => {
  it('series: one per location (by name), the points of each in time order, and the locations listed', () => {
    const t = buildTrends(base(), NOW);
    expect(t.locations).toEqual(['Oficina 1', 'Oficina 2']);
    expect(t.series.map((s) => s.location)).toEqual(['Oficina 1', 'Oficina 2']);
    expect(t.series[0].points.map((p) => p.at)).toEqual([at(8, 10).toISOString(), at(8, 20).toISOString()]);
    expect(t.series[0].points[0]).toMatchObject({ avgTempC: 22, maxTempC: 23, avgHumidityPct: 50, maxSmokePpm: 0, heaterOnPct: 100, motionDetections: 0, doorUnlocks: 0, warnings: 0, alerts: 0 });
  });

  it('keeps null where a bucket has no reading of that kind and rounds to one decimal', () => {
    const i = base(); i.buckets[0] = bucket('Oficina 2', 8, 10, { avgTempC: null, maxTempC: null, avgHumidityPct: 49.84, heaterOnPct: 66.666 });
    const p = buildTrends(i, NOW).series[1].points[0];
    expect(p).toMatchObject({ avgTempC: null, maxTempC: null, avgHumidityPct: 49.8, heaterOnPct: 66.7 });
  });

  it('the temperature threshold and the window come from the data', () => {
    const t = buildTrends(base(), NOW);
    expect(t.thresholds).toEqual({ tempWarningC: 24 });
    expect(t.window).toEqual({ from: at(8, 1).toISOString(), to: at(11, 20).toISOString() });
    expect(t.bucketMinutes).toBe(10);
    expect(t.asOf).toBe(NOW.toISOString());
  });

  it('per location: share of temperature readings over the threshold, peak and counts', () => {
    expect(buildTrends(base(), NOW).byLocation).toEqual([
      { location: 'Oficina 1', tempReadings: 200, warningReadings: 13, warningSharePct: 6.5, peakTempC: 24, heaterReadings: 200, heaterOnPct: 90 },
      { location: 'Oficina 2', tempReadings: 200, warningReadings: 13, warningSharePct: 6.5, peakTempC: 24, heaterReadings: 200, heaterOnPct: 90 },
    ]);
  });

  it('the heater share comes from the real readings, not from averaging the percentages of the buckets, and is null with no heater', () => {
    const i = base();
    i.perLocation[0] = { ...i.perLocation[0], heaterReadings: 9, heaterOn: 6 };   // 6 de 9 = 66,7 %
    i.perLocation[1] = { ...i.perLocation[1], heaterReadings: 0, heaterOn: 0 };
    const [a, b] = buildTrends(i, NOW).byLocation;
    expect(a).toMatchObject({ heaterReadings: 9, heaterOnPct: 66.7 });
    expect(b).toMatchObject({ heaterReadings: 0, heaterOnPct: null });
  });

  it('events come in time order, alerts before warnings when they share the instant', () => {
    const e = buildTrends(base(), NOW).events;
    expect(e.map((x) => [x.at, x.status])).toEqual([[at(8, 14).toISOString(), 'WARNING'], [at(8, 29).toISOString(), 'WARNING'], [at(8, 44).toISOString(), 'WARNING'], [at(8, 59).toISOString(), 'WARNING'], [at(9, 40).toISOString(), 'ALERT'], [at(9, 40).toISOString(), 'ALERT']]);
    expect(e[4]).toMatchObject({ location: 'Oficina 1', deviceName: 'IoT10_1', unit: 'PPM', value: 1.2, note: 'n' });
  });

  describe('insights (rules over the data, with the numbers needed to say it)', () => {
    it('alerts at the same instant in several locations are one high-severity finding', () => {
      const f = buildTrends(base(), NOW).insights.find((x) => x.code === 'simultaneous_alerts')!;
      expect(f).toMatchObject({ severity: 'high', params: { at: at(9, 40).toISOString(), locations: 2, names: 'Oficina 1, Oficina 2' } });
    });

    it('one alert alone is not «simultaneous»', () => {
      const i = base(); i.events = i.events.filter((e) => !(e.status === 'ALERT' && e.location === 'Oficina 2'));
      expect(buildTrends(i, NOW).insights.some((x) => x.code === 'simultaneous_alerts')).toBe(false);
    });

    it('alerts at different instants are not simultaneous', () => {
      const i = base(); i.events[1] = ev(9, 41, 'Oficina 2', 'ALERT');
      expect(buildTrends(i, NOW).insights.some((x) => x.code === 'simultaneous_alerts')).toBe(false);
    });

    it('warnings that repeat at the same interval are a pattern: every 15 minutes, 4 times', () => {
      const f = buildTrends(base(), NOW).insights.find((x) => x.code === 'periodic_warnings')!;
      expect(f).toMatchObject({ severity: 'medium', params: { minutes: 15, count: 4, device: 'TEMP_MON_1', devices: 1 } });
    });

    it('says how many devices follow the same pattern', () => {
      const i = base(); for (const loc of ['2', '3']) for (const [h, m] of [[8, 14], [8, 29], [8, 44]]) i.events.push(ev(h, m, `Oficina ${loc}`, 'WARNING'));
      expect(buildTrends(i, NOW).insights.find((x) => x.code === 'periodic_warnings')!.params).toMatchObject({ minutes: 15, devices: 3, device: 'TEMP_MON_1' });
    });

    it('warnings at irregular intervals are not a pattern', () => {
      const i = base(); i.events = [ev(8, 14, 'Oficina 1', 'WARNING'), ev(8, 31, 'Oficina 1', 'WARNING'), ev(9, 2, 'Oficina 1', 'WARNING'), ev(10, 40, 'Oficina 1', 'WARNING')];
      expect(buildTrends(i, NOW).insights.some((x) => x.code === 'periodic_warnings')).toBe(false);
    });

    it('warnings in every location in a similar amount point to a building-wide cause, not one office', () => {
      const f = buildTrends(base(), NOW).insights.find((x) => x.code === 'warnings_everywhere')!;
      expect(f).toMatchObject({ severity: 'medium', params: { locations: 2, total: 26, tempC: 24 } });
    });

    it('when one location has clearly more warnings, that office is the finding instead', () => {
      const i = base(); i.perLocation[0].warningReadings = 30;
      const codes = buildTrends(i, NOW).insights.map((x) => x.code);
      expect(codes).toContain('office_hotter'); expect(codes).not.toContain('warnings_everywhere');
      expect(buildTrends(i, NOW).insights.find((x) => x.code === 'office_hotter')!.params).toMatchObject({ location: 'Oficina 1', warnings: 30 });
    });

    it('high severity first, then medium, then info', () => {
      const sev = buildTrends(base(), NOW).insights.map((x) => x.severity);
      expect([...sev].sort((a, b) => ['high', 'medium', 'info'].indexOf(a) - ['high', 'medium', 'info'].indexOf(b))).toEqual(sev);
    });

    it('no warnings and no alerts: a single «all normal» note, no alarms', () => {
      const i = base(); i.events = []; i.perLocation = i.perLocation.map((p) => ({ ...p, warningReadings: 0 })); i.tempWarningC = null;
      expect(buildTrends(i, NOW).insights.map((x) => x.code)).toEqual(['all_normal']);
    });
  });

  it('with nothing loaded everything is empty and the window is null', () => {
    const t = buildTrends({ window: null, tempWarningC: null, buckets: [], perLocation: [], events: [] }, NOW);
    expect(t).toMatchObject({ window: null, thresholds: { tempWarningC: null }, locations: [], series: [], byLocation: [], events: [] });
    expect(t.insights.map((x) => x.code)).toEqual(['all_normal']);
  });

  it('does not change what it receives', () => {
    const i = base(); const copy = JSON.stringify(i);
    buildTrends(i, NOW);
    expect(JSON.stringify(i)).toBe(copy);
  });
});
