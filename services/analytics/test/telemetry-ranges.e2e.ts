import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import request from 'supertest';
import { loadIot } from '../prisma/iot-load';
import { bearer, token, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

const file = <T>(n: string): T => JSON.parse(readFileSync(`prisma/data/${n}`, 'utf8'));
type Dev = { id: string; location: string; readingKind: string; unit: string };
const TEMP = file<Dev[]>('iot-devices.json').find((d) => d.readingKind === 'TEMP')!;
const SEED_MAX_ID = Math.max(...file<{ id: number }[]>('iot-readings.json').map((r) => r.id)); // 4200
const SEED_COUNT = file<unknown[]>('iot-readings.json').length;
const LATEST = Date.UTC(2026, 8, 13, 11, 20); // la última lectura del Excel
const DAY = 24 * 3_600_000;

describe('GET /telemetry/trends?range= (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const GET = (path: string) => request(app.getHttpServer()).get(path).set('Authorization', bearer(token(USERS.manager)));
  const insert = (atMs: number, status = 'NORMAL', value = 21) =>
    prisma.$executeRaw`INSERT INTO iot_readings (device_id, recorded_at, status, value, unit) VALUES (${TEMP.id}, ${new Date(atMs)}, ${status}, ${value}, ${TEMP.unit})`;
  const cleanup = () => prisma.iotReading.deleteMany({ where: { id: { gt: SEED_MAX_ID } } });
  const total = (t: { statusCounts: { count: number }[] }) => t.statusCounts.reduce((n, s) => n + s.count, 0);

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); await loadIot(prisma); await cleanup();
    // Una lectura suelta a 2, 20, 100, 300 y 400 días antes de la última: cada rango debe incluir justo las suyas.
    for (const d of [2, 100, 300, 400]) await insert(LATEST - d * DAY);
    await insert(LATEST - 20 * DAY, 'WARNING', 25); // una advertencia vieja: el total de eventos de 1 día no debe contarla
  });
  afterAll(async () => { await cleanup(); await app.close(); await prisma.$disconnect(); });

  const RANGES: [string, number, number][] = [['1d', 10, SEED_COUNT], ['7d', 120, SEED_COUNT + 1], ['30d', 360, SEED_COUNT + 2], ['180d', 2880, SEED_COUNT + 3], ['365d', 5760, SEED_COUNT + 4]];

  it.each(RANGES)('range %s: slot of %i minutes and exactly the readings of that range (%i)', async (range, minutes, count) => {
    const t = (await GET(`/telemetry/trends?range=${range}`)).body;
    expect(t.range.key).toBe(range);
    expect(t.bucketMinutes).toBe(minutes);
    expect(total(t)).toBe(count); // la de hace 400 días no entra en ningún rango
    expect(Date.parse(t.range.to)).toBe(LATEST);
    expect(t.window).toEqual({ from: new Date(LATEST - 400 * DAY).toISOString(), to: new Date(LATEST).toISOString() }); // «window» sigue siendo todo lo guardado
    for (const s of t.series) {
      expect(s.points.length).toBeLessThanOrEqual(145);
      for (const p of s.points) expect((Date.parse(p.at) - Date.UTC(2000, 0, 1)) % (minutes * 60_000)).toBe(0); // los tramos caen en múltiplos del ancho
    }
  });

  it('with no range it answers the last 24 hours, the same as range=1d', async () => {
    const a = (await GET('/telemetry/trends')).body, b = (await GET('/telemetry/trends?range=1d')).body;
    const { asOf: _a, ...ra } = a; const { asOf: _b, ...rb } = b;
    expect(ra).toEqual(rb);
    expect(a.range.key).toBe('1d');
  });

  it('the range counts back from the latest reading, not from today (the data is virtual time)', async () => {
    const t = (await GET('/telemetry/trends?range=7d')).body;
    expect(Date.parse(t.range.from)).toBe(LATEST - 7 * DAY);
    expect(Date.parse(t.range.from)).toBeLessThan(Date.now() - 30 * DAY); // y no tiene nada que ver con el reloj real
  });

  it('a longer range sees the older readings in its series and a shorter one does not', async () => {
    const pointsAt = async (r: string) => (await GET(`/telemetry/trends?range=${r}`)).body.series.flatMap((s: { points: { at: string }[] }) => s.points.map((p) => Date.parse(p.at)));
    expect((await pointsAt('1d')).every((t: number) => t >= LATEST - DAY)).toBe(true);
    expect((await pointsAt('7d')).some((t: number) => t < LATEST - DAY)).toBe(true);
    expect((await pointsAt('365d')).some((t: number) => t < LATEST - 299 * DAY)).toBe(true);
  });

  it.each(['2d', '', '1D', '__proto__', 'constructor', 'toString', '7', '1d;DROP TABLE iot_readings', '1d%00'])('range=%j -> 400 and nothing is read', async (range) => {
    const r = await GET(`/telemetry/trends?range=${encodeURIComponent(range)}`);
    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain('range must be one of');
    expect(r.body.series).toBeUndefined();
  });

  it('the range repeated (an array) is refused too', async () => {
    expect((await GET('/telemetry/trends?range=1d&range=365d')).status).toBe(400);
  });

  it('events: at most the latest 300 are sent, in time order, and the total says how many there are', async () => {
    for (let i = 0; i < 350; i++) await insert(LATEST - 60_000 * (i + 1) - 30_000, 'WARNING', 25); // a los :30 s: el Excel solo tiene minutos exactos de este dispositivo
    const t = (await GET('/telemetry/trends?range=1d')).body;
    expect(t.events).toHaveLength(300);
    expect(t.eventsTotal).toBe(t.statusCounts.filter((s: { severity: string }) => s.severity !== 'normal').reduce((n: number, s: { count: number }) => n + s.count, 0));
    expect(t.eventsTotal).toBeGreaterThan(350);
    const times = t.events.map((e: { at: string }) => Date.parse(e.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times[times.length - 1]).toBeLessThanOrEqual(LATEST);
    await prisma.iotReading.deleteMany({ where: { id: { gt: SEED_MAX_ID }, status: 'WARNING', recordedAt: { gte: new Date(LATEST - DAY) } } }); // las 350 de arriba (la advertencia vieja de hace 20 días se queda)
  });

  it('the insights are computed with at most the latest 5,000 events of the range, while the total keeps the real number', async () => {
    // 5.100 advertencias de un mismo dispositivo, una por minuto, en los 3 días y medio anteriores a la última lectura (a los :15 s: el Excel solo tiene minutos exactos).
    await prisma.$executeRaw`INSERT INTO iot_readings (device_id, recorded_at, status, value, unit)
      SELECT ${TEMP.id}, ${new Date(LATEST - 3_600_000)}::timestamp - (g * INTERVAL '1 minute') - INTERVAL '15 seconds', 'WARNING', 25, ${TEMP.unit} FROM generate_series(0, 5099) AS g`;
    try {
      const t = (await GET('/telemetry/trends?range=7d')).body;
      expect(t.eventsTotal).toBeGreaterThanOrEqual(5100);
      expect(t.events).toHaveLength(300);
      const periodic = t.insights.find((i: { code: string }) => i.code === 'periodic_warnings');
      expect(periodic.params.count).toBeLessThanOrEqual(5000); // sin el tope serían las 5.100 y las del Excel
      expect(periodic.params.count).toBeGreaterThan(4000);
    } finally { await prisma.iotReading.deleteMany({ where: { id: { gt: SEED_MAX_ID }, note: null, status: 'WARNING', value: 25, recordedAt: { gte: new Date(LATEST - 6 * DAY) } } }); }
  });

  it('the counts by severity are those of the range, not of the whole table', async () => {
    const day = (await GET('/telemetry/trends?range=1d')).body, year = (await GET('/telemetry/trends?range=365d')).body;
    expect(total(year) - total(day)).toBe(4);
    for (const s of year.statusCounts) expect(['normal', 'warning', 'alert']).toContain(s.severity);
  });

  it('the per-office figures (temperature readings, warning share) are those of the range too', async () => {
    const tempReadings = async (r: string) => { const t = (await GET(`/telemetry/trends?range=${r}`)).body; return t.byLocation.find((b: { location: string }) => b.location === TEMP.location).tempReadings as number; };
    const day = await tempReadings('1d');
    expect(await tempReadings('7d')).toBe(day + 1); // la lectura de hace 2 días
    expect(await tempReadings('30d')).toBe(day + 2);
    expect(await tempReadings('365d')).toBe(day + 4); // 2, 20, 100 y 300 días (la de 400 no entra)
  });

  it('with an empty table it answers an empty range instead of failing', async () => {
    await prisma.iotReading.deleteMany({});
    try {
      const r = await GET('/telemetry/trends?range=30d');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ range: null, window: null, series: [], events: [], eventsTotal: 0, statusCounts: [] });
    } finally { await loadIot(prisma); await cleanup(); }
  });

  it('roles: only the manager', async () => {
    for (const u of [USERS.lead, USERS.billing, USERS.sales]) expect((await request(app.getHttpServer()).get('/telemetry/trends?range=365d').set('Authorization', bearer(token(u)))).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/telemetry/trends?range=365d')).status).toBe(401);
  });
});
