import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import { loadIot } from '../prisma/iot-load';

process.env.RELAY_ENABLED = 'false'; // el relé se prueba aparte; aquí se mira el outbox
process.env.RATE_LIMIT = '100000';
const KEY = randomBytes(24).toString('hex');
process.env.INGEST_KEY = KEY;

const T0 = Date.UTC(2026, 9, 20, 10, 0); // 2026-10-20 10:00 UTC: después del Excel, en el pasado de hoy
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

describe('ThresholdBreached: one warning per device when it gets WORSE (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let devices: { id: string; unit: string }[] = [];
  const SEED_MAX_ID = 4200;
  const post = (readings: object[], correlation?: string) => {
    let r = request(app.getHttpServer()).post('/telemetry/readings').set('x-ingest-key', KEY);
    if (correlation) r = r.set('x-correlation-id', correlation);
    return r.send({ readings });
  };
  const reading = (d: { id: string; unit: string }, min: number, status: string, value = 30) => ({ deviceId: d.id, recordedAt: at(min), status, value, unit: d.unit });
  const events = () => prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
  const stateOf = async (id: string) => (await prisma.iotDevice.findUniqueOrThrow({ where: { id } }));
  const reset = async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.iotReading.deleteMany({ where: { id: { gt: SEED_MAX_ID } } });
    // Todos los dispositivos de nuevo en «normal», con la última lectura contada ANTES de las de estas pruebas.
    await prisma.iotDevice.updateMany({ data: { alertState: 'normal', alertStateAt: new Date(T0 - 60_000) } });
  };

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init();
    await loadIot(prisma);
    devices = (await prisma.iotDevice.findMany({ select: { id: true, unit: true }, orderBy: { id: 'asc' } }));
  });
  beforeEach(reset);
  afterAll(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.iotReading.deleteMany({ where: { id: { gt: SEED_MAX_ID } } });
    // Deja el estado como lo calcula el seed (última lectura de cada dispositivo).
    await prisma.iotDevice.updateMany({ data: { alertStateAt: null } });
    await loadIot(prisma);
    await app.close(); await prisma.$disconnect();
  });

  it('normal → warning warns once, with the contract fields and the request correlation id', async () => {
    const d = devices[0];
    expect((await post([reading(d, 1, 'WARNING', 31.5)], 'trace-thr-0001')).status).toBe(200);
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'ThresholdBreached', routingKey: 'ops.threshold.breached', aggregateId: `${d.id}:${at(1)}`, publishedAt: null });
    const p: any = ev[0].payload;
    expect(p).toMatchObject({ type: 'ThresholdBreached', correlationId: 'trace-thr-0001', data: { deviceId: d.id, status: 'WARNING', value: 31.5, unit: d.unit, recordedAt: at(1) } });
    expect(typeof p.data.deviceName).toBe('string'); expect(typeof p.data.location).toBe('string'); expect(typeof p.data.readingKind).toBe('string');
    expect(p.eventId).toBe(ev[0].id);
    expect(await stateOf(d.id)).toMatchObject({ alertState: 'warning' });
  });

  it('warning → alert warns again; the same level does not; resending the same batch does not', async () => {
    const d = devices[1];
    await post([reading(d, 1, 'WARNING')]);
    await post([reading(d, 2, 'WARNING')]);
    expect((await events())).toHaveLength(1);
    await post([reading(d, 3, 'ALERT')]);
    expect((await events())).toHaveLength(2);
    const again = await post([reading(d, 3, 'ALERT')]);
    expect(again.body).toEqual({ accepted: 0, duplicates: 1 });
    await post([reading(d, 4, 'ALERT')]);
    expect((await events())).toHaveLength(2);
  });

  it('50 alert readings in one batch warn ONCE (one per device and batch, not per reading)', async () => {
    const d = devices[2];
    const r = await post(Array.from({ length: 50 }, (_, i) => reading(d, i + 1, 'ALERT')));
    expect(r.body).toEqual({ accepted: 50, duplicates: 0 });
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect((ev[0].payload as any).data.recordedAt).toBe(at(50));
  });

  it('a mixed batch warns for the worst reading even if the last one is calm, and ends calm', async () => {
    const d = devices[3];
    await post([reading(d, 2, 'NORMAL'), reading(d, 1, 'ALERT')]);
    expect((await events()).map((e) => (e.payload as any).data.status)).toEqual(['ALERT']);
    expect(await stateOf(d.id)).toMatchObject({ alertState: 'normal' });
  });

  it('is not stuck: alert → normal is silent, and the next alert warns again', async () => {
    const d = devices[4];
    await post([reading(d, 1, 'ALERT')]);
    await post([reading(d, 2, 'NORMAL')]);
    expect((await events())).toHaveLength(1);
    await post([reading(d, 3, 'ALERT')]);
    expect((await events())).toHaveLength(2);
  });

  it('a LATE batch (older than the last counted reading) is stored but changes no state and warns nothing', async () => {
    const d = devices[5];
    await post([reading(d, 10, 'NORMAL')]);
    const late = await post([reading(d, 5, 'ALERT')]);
    expect(late.body).toEqual({ accepted: 1, duplicates: 0 });
    expect(await events()).toHaveLength(0);
    expect((await stateOf(d.id)).alertStateAt?.toISOString()).toBe(at(10));
    expect(await prisma.iotReading.count({ where: { deviceId: d.id, status: 'ALERT', id: { gt: SEED_MAX_ID } } })).toBe(1);
  });

  it('devices are independent: each one warns on its own in the same batch', async () => {
    const [a, b, c] = devices;
    await post([reading(a, 1, 'ALERT'), reading(b, 1, 'NORMAL'), reading(c, 1, 'WARNING')]);
    const who = (await events()).map((e) => (e.payload as any).data.deviceId).sort();
    expect(who).toEqual([a.id, c.id].sort());
  });

  it('the first-ever state comes from the last reading: a device the seed left in alert does not warn for a new alert reading', async () => {
    const d = devices[6];
    await prisma.iotDevice.update({ where: { id: d.id }, data: { alertState: 'alert', alertStateAt: new Date(T0 - 60_000) } });
    await post([reading(d, 1, 'ALERT')]);
    expect(await events()).toHaveLength(0);
  });

  it('ATOMIC: if writing the warning fails, the readings of that batch are NOT stored either', async () => {
    const d = devices[7];
    await prisma.outboxEvent.create({ data: { id: randomUUID(), aggregateId: `${d.id}:${at(1)}`, type: 'ThresholdBreached', routingKey: 'x', payload: {} } }); // choca con la clave única
    const before = await prisma.iotReading.count();
    const r = await post([reading(d, 1, 'ALERT'), reading(devices[8], 1, 'NORMAL')]);
    expect(r.status).toBe(500);
    expect(await prisma.iotReading.count()).toBe(before);
    expect((await stateOf(d.id)).alertState).toBe('normal');
  });

  it('a rejected batch (invalid) stores nothing and warns nothing', async () => {
    const d = devices[0];
    const r = await post([reading(d, 1, 'ALERT'), { ...reading(d, 2, 'ALERT'), value: 'x' }]);
    expect(r.status).toBe(400);
    expect(await events()).toHaveLength(0);
  });

  it('CONCURRENCY: 30 rounds of 8 simultaneous batches on the same device from normal → exactly ONE warning, nobody fails (no deadlock), the state is consistent', async () => {
    const d = devices[9];
    for (let round = 0; round < 30; round++) {
      await reset();
      const base = round * 100;
      const res = await Promise.all(Array.from({ length: 8 }, (_, i) => post([reading(d, base + i + 1, 'WARNING', 30 + i)])));
      expect(res.map((r) => r.status)).toEqual(Array(8).fill(200));
      const ev = await events();
      expect(ev).toHaveLength(1);
      const s = await stateOf(d.id);
      expect(s.alertState).toBe('warning');
      // El estado quedó en la lectura más reciente que alguien contó.
      expect(s.alertStateAt!.getTime()).toBeGreaterThanOrEqual(T0 + (base + 1) * 60_000);
    }
  }, 180_000);

  it('CONCURRENCY with several devices in different orders: no deadlock, one warning per device, never more', async () => {
    const ds = devices.slice(10, 16);
    for (let round = 0; round < 20; round++) {
      await reset();
      const orders = Array.from({ length: 6 }, (_, k) => [...ds].sort(() => (k % 2 ? 1 : -1) * (Math.sin(k + round) > 0 ? 1 : -1)));
      const res = await Promise.all(orders.map((o, k) => post(o.map((d) => reading(d, round * 100 + k + 1, 'ALERT')))));
      expect(res.map((r) => r.status)).toEqual(Array(6).fill(200));
      const ev = await events();
      expect(ev).toHaveLength(ds.length);
      expect(new Set(ev.map((e) => (e.payload as any).data.deviceId)).size).toBe(ds.length);
    }
  }, 180_000);

  it('an upward-then-downward run over time reports exactly the real worsenings', async () => {
    const d = devices[0];
    const seq = ['NORMAL', 'WARNING', 'WARNING', 'ALERT', 'ALERT', 'NORMAL', 'WARNING', 'NORMAL', 'ALERT'];
    for (let i = 0; i < seq.length; i++) await post([reading(d, i + 1, seq[i])]);
    // empeoramientos: n→w (2), w→a (4), n→w (7), n→a (9)
    expect((await events()).map((e) => (e.payload as any).data.status)).toEqual(['WARNING', 'ALERT', 'WARNING', 'ALERT']);
  });
});
