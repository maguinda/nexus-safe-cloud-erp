import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import request from 'supertest';
import { loadIot } from '../prisma/iot-load';
import { loadNetwork } from '../prisma/network-load';
import { bearer, OTHER_KEYS, token, unsigned, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

const file = <T>(n: string): T => JSON.parse(readFileSync(`prisma/data/${n}`, 'utf8'));
type Reading = { id: number; deviceId: string; recordedAt: string; status: string; value: number };
type Dev = { id: string; name: string; kind: string; location: string; readingKind: string };
type NDev = { id: number; name: string; category: string; criticality: string; model: string; ips: string | null };
type NLink = { id: number; originName: string; destinationName: string; linkType: string; functional: boolean | null; criticality: string };

describe('dashboards: trends, filterable readings and the network explorer (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const readings = file<Reading[]>('iot-readings.json');
  const devs = new Map(file<Dev[]>('iot-devices.json').map((d) => [d.id, d]));
  const nDevs = file<NDev[]>('network-devices.json');
  const nLinks = file<NLink[]>('network-links.json');
  const mgr = () => bearer(token(USERS.manager));
  // `null` = sin token (con `undefined` el valor por defecto lo cambiaría por el del gerente).
  const GET = (path: string, auth: string | null = mgr()) => { const r = request(app.getHttpServer()).get(path); return auth ? r.set('Authorization', auth) : r; };

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); await loadIot(prisma); await loadNetwork(prisma); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const ROUTES = ['/telemetry/trends', '/telemetry/readings', '/telemetry/facets', '/network/devices', '/network/links', '/network/facets'];

  describe('authentication and roles (every new route)', () => {
    it.each(ROUTES)('%s: no token -> 401, bad tokens -> 401', async (path) => {
      for (const auth of [null, 'Bearer not.a.jwt', bearer(token(USERS.manager, { expiresIn: -60 })), bearer(token(USERS.manager, { key: OTHER_KEYS.privateKey })), bearer(unsigned(USERS.manager))]) expect((await GET(path, auth)).status).toBe(401);
    });
    it.each(ROUTES)('%s: the manager gets 200', async (path) => { expect((await GET(path)).status).toBe(200); });
    it.each(ROUTES.flatMap((r) => [['project_lead', USERS.lead, r], ['billing_analyst', USERS.billing, r], ['sales', USERS.sales, r]] as const))('%s is refused on %s (403) with no data in the answer', async (_n, u, path) => {
      const r = await GET(path as string, bearer(token(u)));
      expect(r.status).toBe(403);
      expect(Object.keys(r.body).sort()).toEqual(['correlationId', 'error', 'message', 'statusCode']);
    });
  });

  describe('GET /telemetry/trends', () => {
    it('21 ten-minute points per office, from 08:00 to 11:20, three offices in name order', async () => {
      const t = (await GET('/telemetry/trends')).body;
      expect(t.bucketMinutes).toBe(10);
      expect(t.locations).toEqual(['Oficina 1', 'Oficina 2', 'Oficina 3']);
      expect(t.series.map((s: any) => s.points.length)).toEqual([21, 21, 21]);
      expect(t.series[0].points[0].at).toBe('2026-09-13T08:00:00.000Z'); expect(t.series[0].points[20].at).toBe('2026-09-13T11:20:00.000Z');
      expect(t.window).toEqual({ from: '2026-09-13T08:01:00.000Z', to: '2026-09-13T11:20:00.000Z' });
      expect(t.thresholds).toEqual({ tempWarningC: 24 });
    });

    it('the counters of every office add up to the source: 13 warnings, 1 alert, 16 detections, 8 unlocks, heater on 90 %', async () => {
      const t = (await GET('/telemetry/trends')).body;
      for (const s of t.series) {
        const sum = (k: string) => s.points.reduce((n: number, p: any) => n + p[k], 0);
        expect([sum('warnings'), sum('alerts'), sum('motionDetections'), sum('doorUnlocks')]).toEqual([13, 1, 16, 8]);
      }
      // los 10 minutos de 09:40 de la Oficina 1 traen el humo en 1,2 PPM y los demás tramos no
      const o1 = t.series[0].points; const at940 = o1.find((p: any) => p.at === '2026-09-13T09:40:00.000Z');
      expect(at940).toMatchObject({ maxSmokePpm: 1.2, alerts: 1 });
      expect(o1.filter((p: any) => p.maxSmokePpm >= 1).length).toBe(1);
      // un tramo concreto calculado aparte sobre el archivo: temperatura media de la Oficina 1 entre 08:00 y 08:09
      const sel = readings.filter((r) => devs.get(r.deviceId)!.location === 'Oficina 1' && devs.get(r.deviceId)!.readingKind === 'TEMP' && r.recordedAt >= '2026-09-13T08:00:00' && r.recordedAt < '2026-09-13T08:10:00');
      const avg = Math.round((sel.reduce((n, r) => n + r.value, 0) / sel.length) * 10) / 10;
      expect(o1[0].avgTempC).toBe(avg);
      const heater = readings.filter((r) => devs.get(r.deviceId)!.location === 'Oficina 1' && devs.get(r.deviceId)!.readingKind === 'POWER');
      expect(Math.round((heater.filter((r) => r.status === 'ON').length / heater.length) * 1000) / 10).toBe(90);
    });

    it('events: the 42 warnings and alerts in time order, the three alerts together at 09:40', async () => {
      const e = (await GET('/telemetry/trends')).body.events;
      expect(e).toHaveLength(42);
      expect(e.filter((x: any) => x.status === 'ALERT').map((x: any) => [x.at, x.deviceName]).sort()).toEqual([['2026-09-13T09:40:00.000Z', 'IoT10'], ['2026-09-13T09:40:00.000Z', 'IoT10(1)'], ['2026-09-13T09:40:00.000Z', 'IoT10(2)']]);
      const times = e.map((x: any) => x.at); expect([...times].sort()).toEqual(times);
      expect(e.every((x: any) => ['ALERT', 'WARNING'].includes(x.status))).toBe(true);
    });

    it('findings: the simultaneous alerts first (high), then the 15-minute pattern and «everywhere» (medium), each with its numbers', async () => {
      const f = (await GET('/telemetry/trends')).body.insights;
      expect(f.map((x: any) => x.code)).toEqual(['simultaneous_alerts', 'periodic_warnings', 'warnings_everywhere']);
      expect(f[0]).toMatchObject({ severity: 'high', params: { at: '2026-09-13T09:40:00.000Z', locations: 3, names: 'Oficina 1, Oficina 2, Oficina 3', devices: 'IoT10, IoT10(1), IoT10(2)', value: 1.2, unit: 'PPM' } });
      expect(f[1]).toMatchObject({ severity: 'medium', params: { minutes: 15, count: 13, devices: 3, device: 'TEMP_MON_OF1' } });
      expect(f[2]).toMatchObject({ severity: 'medium', params: { locations: 3, total: 39, tempC: 24 } });
    });

    it('per office: 200 temperature readings, 13 over the threshold (6.5 %), a peak of 24 and the heater on 90 % of the time', async () => {
      expect((await GET('/telemetry/trends')).body.byLocation).toEqual(['Oficina 1', 'Oficina 2', 'Oficina 3'].map((location) => ({ location, tempReadings: 200, warningReadings: 13, warningSharePct: 6.5, peakTempC: 24, heaterReadings: 200, heaterOnPct: 90 })));
    });
  });

  describe('GET /telemetry/readings: every filter is checked against the source file', () => {
    const q = async (qs: string) => (await GET(`/telemetry/readings?${qs}`)).body;
    const expectedBy = (f: (r: Reading, d: Dev) => boolean) => readings.filter((r) => f(r, devs.get(r.deviceId)!));

    it('with no filter: all 4200, 50 per page, newest first', async () => {
      const b = await q('');
      expect(b).toMatchObject({ total: 4200, limit: 50, offset: 0 });
      expect(b.items).toHaveLength(50);
      const times = b.items.map((i: any) => i.at); expect([...times].sort().reverse()).toEqual(times);
      expect(b.items[0]).toEqual(expect.objectContaining({ id: expect.any(Number), deviceName: expect.any(String), location: expect.any(String), severity: expect.stringMatching(/normal|warning|alert/), unit: expect.any(String) }));
    });

    it.each([
      ['location=Oficina%202', (_r: Reading, d: Dev) => d.location === 'Oficina 2', 1400],
      ['deviceKind=Smoke%20Detector', (_r: Reading, d: Dev) => d.kind === 'Smoke Detector', 600],
      ['deviceId=IOT-OF1-02', (r: Reading) => r.deviceId === 'IOT-OF1-02', 200],
      ['severity=alert', (r: Reading) => r.status === 'ALERT', 3],
      ['severity=warning', (r: Reading) => r.status === 'WARNING', 39],
      ['severity=normal', (r: Reading) => !['ALERT', 'WARNING'].includes(r.status), 4158],
      ['status=DETECTED', (r: Reading) => r.status === 'DETECTED', 48],
      ['location=Oficina%201&severity=warning', (r: Reading, d: Dev) => d.location === 'Oficina 1' && r.status === 'WARNING', 13],
      ['deviceKind=Door%20%2F%20Lock&status=UNLOCKED', (r: Reading, d: Dev) => d.kind === 'Door / Lock' && r.status === 'UNLOCKED', 24],
      ['from=2026-09-13T09:40:00Z&to=2026-09-13T09:40:00Z', (r: Reading) => r.recordedAt.startsWith('2026-09-13T09:40:00'), 21],
      ['from=2026-09-13T11:00:00Z', (r: Reading) => r.recordedAt >= '2026-09-13T11:00:00', 441],
      ['to=2026-09-13T08:05:00Z', (r: Reading) => r.recordedAt <= '2026-09-13T08:05:00.000Z', 105],
    ])('%s', async (qs, f, expected) => {
      const b = await q(`${qs}&limit=200`);
      const want = expectedBy(f as any);
      expect(want.length).toBe(expected); // la cuenta independiente sobre el archivo
      expect(b.total).toBe(expected);
      expect(b.items.length).toBe(Math.min(200, expected));
    });

    it('«Oficina 1» + warning: the 13 items really are warnings of Oficina 1', async () => {
      const b = await q('location=Oficina%201&severity=warning&limit=50');
      expect(b.items.every((i: any) => i.location === 'Oficina 1' && i.status === 'WARNING' && i.severity === 'warning' && i.value === 24)).toBe(true);
    });

    it('a filter with no match is an empty list, not an error', async () => {
      expect(await q('location=Oficina%209')).toMatchObject({ total: 0, items: [] });
      expect(await q('severity=alert&location=Oficina%201&status=ACTIVE')).toMatchObject({ total: 0, items: [] });
    });

    it('sorting: by value (both ways), by device name (in the database order) and by status', async () => {
      const max = Math.max(...readings.map((r) => r.value)), min = Math.min(...readings.map((r) => r.value));
      const desc = (await q('sort=value&order=desc&limit=200')).items.map((i: any) => i.value);
      expect(desc[0]).toBe(max); expect(desc).toEqual([...desc].sort((a: number, b: number) => b - a));
      const asc = (await q('sort=value&order=asc&limit=200')).items.map((i: any) => i.value);
      expect(asc[0]).toBe(min); expect(asc).toEqual([...asc].sort((a: number, b: number) => a - b));
      // el orden por nombre es el de la base (el de JavaScript puede diferir con paréntesis y mayúsculas): se compara con su propio ORDER BY
      const order = (await prisma.$queryRawUnsafe<{ name: string }[]>('SELECT name FROM iot_devices ORDER BY name ASC')).map((r) => r.name);
      const rank = (n: string) => order.indexOf(n);
      const byDevice = (await q('sort=device&order=asc&limit=200')).items.map((i: any) => rank(i.deviceName));
      expect(byDevice).toEqual([...byDevice].sort((a: number, b: number) => a - b)); expect(byDevice[0]).toBe(0);
      const byDeviceDesc = (await q('sort=device&order=desc&limit=200')).items.map((i: any) => rank(i.deviceName));
      expect(byDeviceDesc).toEqual([...byDeviceDesc].sort((a: number, b: number) => b - a)); expect(byDeviceDesc[0]).toBe(order.length - 1);
      const st = (await q('sort=status&order=asc&limit=200')).items.map((i: any) => i.status); expect(st).toEqual([...st].sort());
    });

    it('paging: every page is different, they join without gaps or repeats, and the last one is short', async () => {
      const seen = new Set<number>();
      for (let offset = 0; offset < 4200; offset += 200) { const b = await q(`limit=200&offset=${offset}&sort=at&order=asc`); for (const i of b.items) { expect(seen.has(i.id)).toBe(false); seen.add(i.id); } }
      expect(seen.size).toBe(4200);
      const last = await q('limit=50&offset=4180'); expect(last.items).toHaveLength(20);
      expect((await q('limit=50&offset=4200')).items).toEqual([]);
    });

    it.each([
      ['limit=201'], ['limit=0'], ['limit=abc'], ['offset=-1'], ['offset=100001'], ['order=sideways'], ['sort=password'], ['severity=critical'], ['status=warning'], ['status=WARN%20ING'],
      ['from=yesterday'], ['to=2026-13-45'], ['location=%27%3B%20DROP%20TABLE%20iot_readings%3B--'], ['deviceId=a%20b'], ['deviceKind=%3Cscript%3E'], ['unknown=1'], ['limit=1&limit=2'],
    ])('a bad filter (%s) is a 400 and changes nothing', async (qs) => {
      expect((await GET(`/telemetry/readings?${qs}`)).status).toBe(400);
      expect(await prisma.iotReading.count()).toBe(4200);
    });

    it('«from» after «to» is a 400 with a clear message', async () => {
      const r = await GET('/telemetry/readings?from=2026-09-13T10:00:00Z&to=2026-09-13T09:00:00Z');
      expect(r.status).toBe(400); expect(r.body.message).toMatch(/from must not be after to/);
    });

    it('facets: 3 offices, 7 kinds of device, the statuses with their counts (they add up to 4200) and the time window', async () => {
      const f = (await GET('/telemetry/facets')).body;
      expect(f.locations).toEqual(['Oficina 1', 'Oficina 2', 'Oficina 3']);
      expect(f.deviceKinds).toEqual(['Door / Lock', 'Heating Element', 'Humidifier', 'Motion Detector', 'Smoke Detector', 'Temperature Monitor', 'Webcam / Cámara IP']);
      expect(f.statuses.reduce((n: number, s: any) => n + s.count, 0)).toBe(4200);
      expect(f.statuses.find((s: any) => s.status === 'ALERT')).toEqual({ status: 'ALERT', severity: 'alert', count: 3 });
      expect(f.statuses.find((s: any) => s.status === 'WARNING')).toEqual({ status: 'WARNING', severity: 'warning', count: 39 });
      expect(f.window).toEqual({ from: '2026-09-13T08:01:00.000Z', to: '2026-09-13T11:20:00.000Z' });
    });

    it('every answer is quick and the biggest page weighs little', async () => {
      const t = Date.now(); const r = await GET('/telemetry/readings?limit=200'); expect(Date.now() - t).toBeLessThan(2000);
      expect(JSON.stringify(r.body).length).toBeLessThan(90_000);
    });
  });

  describe('the network explorer', () => {
    const d = async (qs: string) => (await GET(`/network/devices?${qs}`)).body;
    const l = async (qs: string) => (await GET(`/network/links?${qs}`)).body;

    it.each([
      ['category=Laptop', nDevs.filter((x) => x.category === 'Laptop').length, 36],
      ['criticality=Cr%C3%ADtica', nDevs.filter((x) => x.criticality === 'Crítica').length, 5],
      ['criticality=Alta', 5, 5], ['criticality=Media', 66, 66],
      ['monitored=yes', 10, 10], ['monitored=no', 66, 66],
      ['category=Switch%20Acceso&monitored=yes', 5, 5], ['category=PC&monitored=yes', 0, 0],
      ['q=3560', nDevs.filter((x) => `${x.name} ${x.model} ${x.ips ?? ''}`.toLowerCase().includes('3560')).length, 2],
    ])('devices %s -> %s (source %s)', async (qs, fromFile, expected) => {
      expect(fromFile).toBe(expected);
      expect((await d(`${qs}&limit=200`)).total).toBe(expected);
    });

    it('devices: no filter gives 76; the monitored ones carry their flags and link count, the others have null flags', async () => {
      const b = await d('limit=200');
      expect(b.total).toBe(76);
      const core = b.items.find((i: any) => i.name === 'Multilayer Switch0');
      expect(core).toMatchObject({ monitored: true, syslog: false, snmp: false, ntp: false, netflow: true, criticality: 'Crítica', model: '3560-24PS' });
      const expectedLinks = nLinks.filter((x) => x.originName === 'Multilayer Switch0' || x.destinationName === 'Multilayer Switch0').length;
      expect(core.links).toBe(expectedLinks);
      const pc = b.items.find((i: any) => i.category === 'PC');
      expect(pc).toMatchObject({ monitored: false, syslog: null, snmp: null, ntp: null, netflow: null });
    });

    it('devices: sorting by criticality puts «Crítica» first (it is not alphabetical) and back again', async () => {
      const asc = await d('sort=criticality&order=asc&limit=200'); expect(asc.items.slice(0, 5).every((i: any) => i.criticality === 'Crítica')).toBe(true); expect(asc.items[5].criticality).toBe('Alta'); expect(asc.items[75].criticality).toBe('Media');
      const desc = await d('sort=criticality&order=desc&limit=200'); expect(desc.items[0].criticality).toBe('Media'); expect(desc.items[75].criticality).toBe('Crítica');
    });

    it('devices: paging joins without gaps', async () => {
      const ids = new Set<number>();
      for (let offset = 0; offset < 76; offset += 30) for (const i of (await d(`limit=30&offset=${offset}&sort=id&order=asc`)).items) { expect(ids.has(i.id)).toBe(false); ids.add(i.id); }
      expect(ids.size).toBe(76);
    });

    it.each([
      ['linkType=eCopper', nLinks.filter((x) => x.linkType === 'eCopper').length, 69], ['linkType=eCustomIOLink', 5, 5],
      ['functional=yes', 69, 69], ['functional=no', 0, 0], ['functional=unknown', 5, 5],
      ['criticality=Cr%C3%ADtica', nLinks.filter((x) => x.criticality === 'Crítica').length, 11], ['criticality=Alta', 63, 63],
      ['device=Multilayer%20Switch0', nLinks.filter((x) => x.originName === 'Multilayer Switch0' || x.destinationName === 'Multilayer Switch0').length, nLinks.filter((x) => x.originName === 'Multilayer Switch0' || x.destinationName === 'Multilayer Switch0').length],
      ['linkType=eCopper&functional=unknown', 0, 0],
    ])('links %s -> %s (source %s)', async (qs, fromFile, expected) => {
      expect(fromFile).toBe(expected);
      expect((await l(`${qs}&limit=200`)).total).toBe(expected);
    });

    it('links: no filter gives 74 and every link names two devices of the inventory', async () => {
      const b = await l('limit=200'); expect(b.total).toBe(74);
      const names = new Set(nDevs.map((x) => x.name));
      expect(b.items.every((i: any) => names.has(i.origin) && names.has(i.destination))).toBe(true);
    });

    it('facets: the categories, the three criticalities in order and the two link types', async () => {
      const f = (await GET('/network/facets')).body;
      expect(f.criticalities).toEqual(['Crítica', 'Alta', 'Media']);
      expect(f.linkTypes).toEqual(['eCopper', 'eCustomIOLink']);
      expect(f.categories).toEqual([...new Set(nDevs.map((x) => x.category))].sort((a, b) => a.localeCompare(b)));
    });

    it.each([
      ['/network/devices?limit=201'], ['/network/devices?criticality=Baja'], ['/network/devices?monitored=maybe'], ['/network/devices?sort=serial'], ['/network/devices?q=%27%3B%20DROP'], ['/network/devices?category=%3Cscript%3E'], ['/network/devices?unknown=1'],
      ['/network/links?functional=maybe'], ['/network/links?sort=password'], ['/network/links?device=%27%3B--'], ['/network/links?offset=-5'], ['/network/links?linkType=a%0Ab'],
    ])('a bad filter %s is a 400', async (path) => { expect((await GET(path)).status).toBe(400); });

    it('the summary now carries its findings: no Syslog/SNMP/NTP anywhere, 1 of the 5 critical pieces (ASA0) with nothing configured, NetFlow on 4 of 10', async () => {
      const f = (await GET('/network/summary')).body.insights;
      expect(f.map((x: any) => x.code)).toEqual(['monitoring_basics_missing', 'critical_unmonitored', 'netflow_partial', 'links_without_status']);
      expect(f[0]).toMatchObject({ severity: 'high', params: { equipment: 10, syslog: 0, snmp: 0, ntp: 0 } });
      expect(f[1]).toMatchObject({ severity: 'high', params: { count: 1, critical: 5, names: 'ASA0' } }); // el cortafuegos es el único crítico sin NetFlow ni nada
      expect(f[2]).toMatchObject({ severity: 'medium', params: { withNetflow: 4, equipment: 10 } });
      expect(f[3]).toMatchObject({ severity: 'info', params: { count: 5 } });
    });
  });
});
