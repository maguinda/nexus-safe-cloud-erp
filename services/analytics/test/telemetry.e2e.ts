import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import request from 'supertest';
import { loadIot } from '../prisma/iot-load';
import { bearer, OTHER_KEYS, token, unsigned, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false'; // estas pruebas no necesitan RabbitMQ
process.env.RATE_LIMIT = '100000';

const file = <T>(n: string): T => JSON.parse(readFileSync(`prisma/data/${n}`, 'utf8'));
type Reading = { id: number; deviceId: string; status: string; value: number; recordedAt: string };

describe('telemetry: the Nexus data loaded into Analytics and read by the manager (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const readings = file<Reading[]>('iot-readings.json');
  const devices = file<{ id: string; location: string }[]>('iot-devices.json');
  const get = (auth?: string) => { const r = request(app.getHttpServer()).get('/telemetry/summary'); return auth ? r.set('Authorization', auth) : r; };
  const manager = () => bearer(token(USERS.manager));
  const wipe = async () => { await prisma.iotReading.deleteMany(); await prisma.iotDevice.deleteMany(); };

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(async () => { await wipe(); await loadIot(prisma); });
  afterAll(async () => { await wipe(); await loadIot(prisma); await app.close(); await prisma.$disconnect(); }); // la demo queda con sus datos

  describe('authentication and roles', () => {
    const bad: [string, string | undefined][] = [
      ['no token', undefined], ['garbage', 'Bearer not.a.jwt'], ['expired', bearer(token(USERS.manager, { expiresIn: -60 }))],
      ['signed with another key', bearer(token(USERS.manager, { key: OTHER_KEYS.privateKey }))], ['alg=none', bearer(unsigned(USERS.manager))],
      ['unknown role', bearer(token({ ...USERS.lead, role: 'admin' }))],
    ];
    for (const [name, auth] of bad) it(`${name} -> 401`, async () => { expect((await get(auth)).status).toBe(401); });

    it('the manager gets 200', async () => { expect((await get(manager())).status).toBe(200); });
    it.each([['project_lead', USERS.lead], ['billing_analyst', USERS.billing], ['sales', USERS.sales]])('%s gets 403 and no figure leaks', async (_n, u) => {
      const r = await get(bearer(token(u)));
      expect(r.status).toBe(403);
      expect(Object.keys(r.body).sort()).toEqual(['correlationId', 'error', 'message', 'statusCode']);
      expect(JSON.stringify(r.body)).not.toMatch(/IOT-|Oficina|totals|readings/);
    });
  });

  describe('what the manager reads', () => {
    it('matches the source file exactly: 21 devices, 4200 readings, 39 warnings and 3 alerts', async () => {
      const b = (await get(manager())).body;
      expect(b.totals).toEqual({ devices: 21, online: 21, readings: 4200, normal: 4158, warnings: 39, alerts: 3 });
      // el mismo cálculo, hecho aparte sobre el archivo
      expect(b.totals.warnings).toBe(readings.filter((r) => r.status === 'WARNING').length);
      expect(b.totals.alerts).toBe(readings.filter((r) => r.status === 'ALERT').length);
      expect(b.window).toEqual({ from: '2026-09-13T08:01:00.000Z', to: '2026-09-13T11:20:00.000Z' });
      expect(b.devices).toHaveLength(21);
      expect(b.byLocation.map((l: any) => [l.location, l.devices])).toEqual([['Oficina 1', 7], ['Oficina 2', 7], ['Oficina 3', 7]]);
    });

    it('the warning and alert counters per device add up to the totals, and the last reading decides the state', async () => {
      const b = (await get(manager())).body;
      expect(b.devices.reduce((n: number, d: any) => n + d.warnings, 0)).toBe(39);
      expect(b.devices.reduce((n: number, d: any) => n + d.alerts, 0)).toBe(3);
      for (const d of b.devices) {
        const last = readings.filter((r) => r.deviceId === d.id).sort((x, y) => y.recordedAt.localeCompare(x.recordedAt))[0];
        expect(d.lastStatus).toBe(last.status); expect(d.lastValue).toBe(last.value); expect(d.lastAt).toBe(last.recordedAt);
      }
    });

    it('the attention list puts the 3 alerts first, then the newest warnings, each group newest first, with the device named', async () => {
      const b = (await get(manager())).body;
      expect(b.attention).toHaveLength(8);
      expect(b.attention.map((a: any) => a.status)).toEqual(['ALERT', 'ALERT', 'ALERT', 'WARNING', 'WARNING', 'WARNING', 'WARNING', 'WARNING']);
      for (const group of [b.attention.slice(0, 3), b.attention.slice(3)]) { const t = group.map((a: any) => a.at); expect([...t].sort().reverse()).toEqual(t); }
      expect(b.attention[0]).toEqual(expect.objectContaining({ deviceName: expect.any(String), location: expect.stringMatching(/^Oficina \d$/), note: expect.any(String) }));
      // exactamente lo que dice el archivo fuente: las 3 alertas y las 5 advertencias más recientes (empates por id), en ese orden
      const newest = (status: string, n: number) => readings.filter((r) => r.status === status).sort((x, y) => y.recordedAt.localeCompare(x.recordedAt) || y.id - x.id).slice(0, n).map((r) => [r.deviceId, r.recordedAt]);
      expect(b.attention.map((a: any) => [a.deviceId, a.at])).toEqual([...newest('ALERT', 3), ...newest('WARNING', 5)]);
    });

    it('answers fast: the dashboard never loads the 4200 rows', async () => {
      const t = Date.now(); expect((await get(manager())).status).toBe(200); expect(Date.now() - t).toBeLessThan(2000);
    });

    it('with nothing loaded it answers 200 with zeros, not an error', async () => {
      await wipe();
      const b = (await get(manager())).body;
      expect(b).toEqual(expect.objectContaining({ window: null, devices: [], byLocation: [], attention: [], totals: { devices: 0, online: 0, readings: 0, normal: 0, warnings: 0, alerts: 0 } }));
    });
  });

  describe('the loader', () => {
    it('is idempotent: loading again changes nothing', async () => {
      const again = await loadIot(prisma);
      expect(again).toEqual({ devices: 21, readings: 4200 });
      expect((await get(manager())).body.totals.readings).toBe(4200);
    });

    it('finishes a half-done load without duplicating what is already there', async () => {
      await prisma.iotReading.deleteMany({ where: { id: { gt: 2000 } } });
      expect(await prisma.iotReading.count()).toBe(2000);
      expect(await loadIot(prisma)).toEqual({ devices: 21, readings: 4200 });
    });

    it('every device in the source has exactly 200 readings', async () => {
      const rows = await prisma.iotReading.groupBy({ by: ['deviceId'], _count: { _all: true } });
      expect(rows).toHaveLength(devices.length);
      expect(rows.every((r) => r._count._all === 200)).toBe(true);
    });
  });

  describe('the database refuses what it should', () => {
    const ok = { id: 99001, deviceId: 'IOT-OF1-01', recordedAt: new Date('2030-01-01T00:00:00Z'), status: 'NORMAL', value: 1, unit: 'X', note: null };
    it('a reading of a device that is not in the inventory (foreign key)', async () => { await expect(prisma.iotReading.create({ data: { ...ok, deviceId: 'IOT-NOPE' } })).rejects.toThrow(); });
    it('a second reading of the same device at the same instant (unique)', async () => {
      await prisma.iotReading.create({ data: ok });
      await expect(prisma.iotReading.create({ data: { ...ok, id: 99002 } })).rejects.toThrow();
    });
    it('an empty status', async () => { await expect(prisma.iotReading.create({ data: { ...ok, status: '' } })).rejects.toThrow(); });
    // Con SQL directo: el cliente de Prisma ya rechaza NaN e infinitos antes de llegar a la base, y aquí se prueba la regla de la base.
    it.each(['NaN', 'Infinity', '-Infinity'])('a value that is %s (CHECK in the database)', async (v) => {
      await expect(prisma.$executeRawUnsafe(`INSERT INTO iot_readings (id, device_id, recorded_at, status, value, unit) VALUES (99003, 'IOT-OF1-01', '2030-01-02', 'NORMAL', '${v}'::float8, 'X')`)).rejects.toThrow(/iot_readings_value_finite_check/);
    });
    it('a connection that is neither ONLINE nor OFFLINE', async () => {
      await expect(prisma.iotDevice.create({ data: { id: 'X', name: 'x', kind: 'x', location: 'x', vlan: 'x', ipAddress: 'x', macAddress: 'x', connection: 'MAYBE', readingKind: 'TEMP', unit: 'x' } })).rejects.toThrow();
    });
    it('deleting a device that still has readings (restrict)', async () => { await expect(prisma.iotDevice.delete({ where: { id: 'IOT-OF1-01' } })).rejects.toThrow(); });
  });
});
