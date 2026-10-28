import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import request from 'supertest';
import { loadIot } from '../prisma/iot-load';
import { bearer, token, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';
const KEY = randomBytes(24).toString('hex'); // 48 caracteres: solo para esta prueba
process.env.INGEST_KEY = KEY;

const file = <T>(n: string): T => JSON.parse(readFileSync(`prisma/data/${n}`, 'utf8'));
const DEVICES = file<{ id: string; unit: string }[]>('iot-devices.json');
const SEED_MAX_ID = Math.max(...file<{ id: number }[]>('iot-readings.json').map((r) => r.id)); // 4200
const SEED_COUNT = file<unknown[]>('iot-readings.json').length;
const BASE = Date.UTC(2026, 8, 13, 11, 21); // el minuto que sigue a la última lectura del Excel (11:20)

/** `n` lecturas válidas en el minuto `minute` después del 11:21 (una por dispositivo, hasta `n`). */
const batch = (minute: number, n = DEVICES.length) => ({
  readings: DEVICES.slice(0, n).map((d, i) => ({ deviceId: d.id, recordedAt: new Date(BASE + minute * 60_000).toISOString(), status: 'NORMAL', value: 20 + i + minute / 100, unit: d.unit, note: `sim ${minute}` })),
});

describe('telemetry ingestion: POST /telemetry/readings (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const extras = () => prisma.iotReading.count({ where: { id: { gt: SEED_MAX_ID } } });
  const cleanup = () => prisma.iotReading.deleteMany({ where: { id: { gt: SEED_MAX_ID } } });
  const post = (body: unknown, key: string | null = KEY, extra: Record<string, string> = {}) => {
    let r = request(app.getHttpServer()).post('/telemetry/readings').set(extra);
    if (key !== null) r = r.set('x-ingest-key', key);
    return r.send(body as object);
  };

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); await loadIot(prisma); await cleanup(); });
  afterEach(cleanup);
  afterAll(async () => { await cleanup(); await app.close(); await prisma.$disconnect(); });

  describe('who may ingest: only the service key', () => {
    it('no key -> 401, nothing stored', async () => {
      const r = await post(batch(0), null);
      expect(r.status).toBe(401);
      expect(Object.keys(r.body).sort()).toEqual(['correlationId', 'error', 'message', 'statusCode']);
      expect(await extras()).toBe(0);
    });

    it.each([['wrong key of the same length', 'x'.repeat(48)], ['a prefix of the key', KEY.slice(0, 47)], ['the key plus one character', `${KEY}x`], ['empty key', ''], ['a very long key', 'k'.repeat(5000)], ['the key in another case', KEY.toUpperCase()]])('%s -> 401 with the same message, nothing stored', async (_n, key) => {
      const r = await post(batch(0), key);
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('Invalid ingestion key');
      expect(await extras()).toBe(0);
    });

    it('the key in the query string or the body is ignored', async () => {
      expect((await request(app.getHttpServer()).post(`/telemetry/readings?x-ingest-key=${KEY}`).send(batch(0))).status).toBe(401);
      expect((await post({ ...batch(0), 'x-ingest-key': KEY }, null)).status).toBe(401);
      expect(await extras()).toBe(0);
    });

    it('a manager token is NOT enough to ingest (people are not emitters), with or without a wrong key', async () => {
      const auth = { Authorization: bearer(token(USERS.manager)) };
      expect((await post(batch(0), null, auth)).status).toBe(401);
      expect((await post(batch(0), 'x'.repeat(48), auth)).status).toBe(401);
      expect(await extras()).toBe(0);
    });

    it('the key opens ONLY this route: with it (and no token) the rest of the API still answers 401', async () => {
      for (const path of ['/telemetry/summary', '/telemetry/trends', '/telemetry/facets', '/network/summary', '/dashboard']) {
        expect((await request(app.getHttpServer()).get(path).set('x-ingest-key', KEY)).status).toBe(401);
      }
      expect((await request(app.getHttpServer()).get('/telemetry/readings').set('x-ingest-key', KEY)).status).toBe(401); // el GET del mismo nombre sigue pidiendo JWT
    });

    it('with the right key it answers 200 and says what it stored', async () => {
      const r = await post(batch(0));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ accepted: DEVICES.length, duplicates: 0 });
      expect(await extras()).toBe(DEVICES.length);
    });

    it.each([['not configured', ''], ['too short to be safe', 'short-key']])('when the server key is %s, ingestion answers 503 even with that key', async (_n, serverKey) => {
      const previous = process.env.INGEST_KEY;
      process.env.INGEST_KEY = serverKey;
      const { createApp } = require('../src/app.factory');
      const other: INestApplication = await createApp(); await other.init();
      try {
        for (const sent of [serverKey, KEY, null]) {
          let r = request(other.getHttpServer()).post('/telemetry/readings'); if (sent !== null) r = r.set('x-ingest-key', sent);
          expect((await r.send(batch(0))).status).toBe(503);
        }
        expect(await extras()).toBe(0);
      } finally { await other.close(); process.env.INGEST_KEY = previous; }
    });
  });

  describe('what it accepts: the whole batch or nothing', () => {
    it('one invalid reading rejects the whole batch (400) and not even the valid ones are stored', async () => {
      const b = batch(0, 5);
      b.readings[3] = { ...b.readings[3], value: 'warm' as unknown as number };
      const r = await post(b);
      expect(r.status).toBe(400);
      expect(r.body.message).toContain('readings[3].value');
      expect(await extras()).toBe(0);
    });

    it('reports every problem, not only the first', async () => {
      const b = batch(0, 3);
      b.readings[0] = { ...b.readings[0], status: 'BROKEN' };
      b.readings[2] = { ...b.readings[2], deviceId: 'NOPE' };
      const r = await post(b);
      expect(r.status).toBe(400);
      expect(r.body.message).toContain('readings[0].status');
      expect(r.body.message).toContain('readings[2].deviceId');
    });

    it.each([
      ['an unknown device', (x: any) => ({ ...x, deviceId: 'IOT-NOPE-99' })],
      ['a unit that is not the device\'s', (x: any) => ({ ...x, unit: x.unit === 'W' ? '%' : 'W' })],
      ['a status outside the catalog', (x: any) => ({ ...x, status: 'ON FIRE' })],
      ['a lowercase status', (x: any) => ({ ...x, status: 'normal' })],
      ['a reading from the future', (x: any) => ({ ...x, recordedAt: new Date(Date.now() + 3_600_000).toISOString() })],
      ['a date without a zone', (x: any) => ({ ...x, recordedAt: '2026-09-13T11:21:00' })],
      ['a date that does not exist', (x: any) => ({ ...x, recordedAt: '2026-02-31T11:21:00Z' })],
      ['a value as text', (x: any) => ({ ...x, value: '22.5' })],
      ['the text NaN', (x: any) => ({ ...x, value: 'NaN' })],
      ['null as value', (x: any) => ({ ...x, value: null })],
      ['an id chosen by the sender', (x: any) => ({ ...x, id: 1 })],
      ['a huge note', (x: any) => ({ ...x, note: 'n'.repeat(201) })],
    ])('rejects %s (400) and stores nothing', async (_n, mutate) => {
      const b = batch(0, 2); b.readings[1] = mutate(b.readings[1]);
      expect((await post(b)).status).toBe(400);
      expect(await extras()).toBe(0);
    });

    it('rejects an infinite value written as 1e999 in the raw JSON (JSON.parse turns it into Infinity)', async () => {
      const raw = JSON.stringify(batch(0, 1)).replace(/"value":[0-9.]+/, '"value":1e999');
      expect(raw).toContain('1e999');
      const r = await request(app.getHttpServer()).post('/telemetry/readings').set('x-ingest-key', KEY).set('Content-Type', 'application/json').send(raw);
      expect(r.status).toBe(400);
      expect(await extras()).toBe(0);
    });

    it('rejects the same device and instant twice in one batch', async () => {
      const b = batch(0, 1); b.readings.push({ ...b.readings[0] });
      expect((await post(b)).status).toBe(400);
      expect(await extras()).toBe(0);
    });

    it('rejects an empty batch, a missing "readings", the wrong type and extra top-level fields', async () => {
      for (const body of [{ readings: [] }, {}, { readings: 'x' }, { readings: {} }, [], 'text', { ...batch(0, 1), extra: true }]) expect((await post(body)).status).toBe(400);
      expect(await extras()).toBe(0);
    });

    it('accepts exactly 50 readings and rejects 51', async () => {
      const mk = (n: number) => ({ readings: Array.from({ length: n }, (_, i) => ({ deviceId: DEVICES[0].id, recordedAt: new Date(BASE + i * 60_000).toISOString(), status: 'NORMAL', value: 20, unit: DEVICES[0].unit })) });
      const r51 = await post(mk(51)); expect(r51.status).toBe(400); expect(await extras()).toBe(0);
      const r50 = await post(mk(50)); expect(r50.status).toBe(200); expect(r50.body.accepted).toBe(50);
    });

    it('a malformed JSON is a 400 and a body over the 10 KB limit is a 413, both with the standard error shape', async () => {
      const bad = await request(app.getHttpServer()).post('/telemetry/readings').set('x-ingest-key', KEY).set('Content-Type', 'application/json').send('{"readings": [');
      expect(bad.status).toBe(400);
      const huge = await post({ readings: [{ ...batch(0, 1).readings[0], note: 'x'.repeat(12_000) }] });
      expect(huge.status).toBe(413);
      expect(Object.keys(huge.body).sort()).toEqual(['correlationId', 'error', 'message', 'statusCode']);
      expect(await extras()).toBe(0);
    });

    it('stores the instant, not the text: a reading written with a zone offset lands on the right UTC minute', async () => {
      const b = batch(0, 1); b.readings[0].recordedAt = '2026-09-13T06:21:00-05:00'; // = 11:21 UTC
      expect((await post(b)).status).toBe(200);
      const row = await prisma.iotReading.findFirst({ where: { id: { gt: SEED_MAX_ID } } });
      expect(row!.recordedAt.toISOString()).toBe('2026-09-13T11:21:00.000Z');
    });
  });

  describe('idempotency and ids', () => {
    it('sending the same batch again stores nothing new and says so', async () => {
      expect((await post(batch(0))).body).toEqual({ accepted: DEVICES.length, duplicates: 0 });
      expect((await post(batch(0))).body).toEqual({ accepted: 0, duplicates: DEVICES.length });
      expect(await extras()).toBe(DEVICES.length);
    });

    it('a batch that overlaps a previous one stores only what is new', async () => {
      await post(batch(0, 10));
      const r = await post(batch(0, 15));
      expect(r.body).toEqual({ accepted: 5, duplicates: 10 });
      expect(await extras()).toBe(15);
    });

    it('a duplicate keeps the ORIGINAL reading: the second value does not overwrite the first', async () => {
      const first = batch(0, 1); await post(first);
      const second = batch(0, 1); second.readings[0].value = 999; second.readings[0].status = 'ALERT';
      await post(second);
      const row = await prisma.iotReading.findFirstOrThrow({ where: { deviceId: DEVICES[0].id, recordedAt: new Date(BASE) } });
      expect(row.value).toBe(first.readings[0].value);
      expect(row.status).toBe('NORMAL');
    });

    it('new readings get ids after the seed (> 4200), unique and increasing within the batch; the seed is untouched', async () => {
      await post(batch(0)); await post(batch(1));
      const rows = await prisma.iotReading.findMany({ where: { id: { gt: SEED_MAX_ID } }, orderBy: { id: 'asc' } });
      expect(rows).toHaveLength(DEVICES.length * 2);
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
      expect(rows[0].id).toBeGreaterThan(SEED_MAX_ID);
      expect(await prisma.iotReading.count({ where: { id: { lte: SEED_MAX_ID } } })).toBe(SEED_COUNT);
    });
  });

  describe('concurrency: the same data arriving twice at once', () => {
    it('30 rounds of two identical batches in parallel: never a duplicate, never a 500, and the counts add up', async () => {
      let totalStored = 0;
      for (let round = 0; round < 30; round++) {
        const b = batch(round);
        const [a, c] = await Promise.all([post(b), post(b)]);
        expect([a.status, c.status]).toEqual([200, 200]);
        // Invariante: entre los dos envíos entró cada lectura exactamente UNA vez.
        expect(a.body.accepted + c.body.accepted).toBe(DEVICES.length);
        expect(a.body.duplicates + c.body.duplicates).toBe(DEVICES.length);
        totalStored += DEVICES.length;
        expect(await extras()).toBe(totalStored);
      }
      const dup = await prisma.$queryRawUnsafe<{ n: bigint }[]>('SELECT count(*) AS n FROM (SELECT device_id, recorded_at FROM iot_readings GROUP BY 1, 2 HAVING count(*) > 1) d');
      expect(Number(dup[0].n)).toBe(0);
    }, 120_000);

    it('30 rounds of two emitters whose batches overlap by half: every reading in the union is stored once', async () => {
      let union = 0;
      for (let round = 0; round < 30; round++) {
        const left = batch(round, 14); const right = batch(round, 21); // el segundo contiene al primero
        right.readings = right.readings.slice(7); // dispositivos 7..20: se solapan con 7..13 del primero
        const [a, c] = await Promise.all([post(left), post(right)]);
        expect([a.status, c.status]).toEqual([200, 200]);
        union += DEVICES.length; // 0..13 U 7..20 = 21 dispositivos
        expect(a.body.accepted + c.body.accepted).toBe(DEVICES.length);
        expect(await extras()).toBe(union);
      }
    }, 120_000);
  });

  describe('a fresh database: the migration runs on an EMPTY table and the seed is loaded afterwards (what CI and a new deployment do)', () => {
    const reload = async (restartAt: number) => {
      await prisma.iotReading.deleteMany();
      await prisma.$executeRawUnsafe(`ALTER TABLE "iot_readings" ALTER COLUMN "id" RESTART WITH ${restartAt}`);
      await loadIot(prisma); // carga las lecturas del Excel con sus ids 1 a 4200, escritos a mano
    };
    afterAll(async () => { await reload(1); }); // deja la base como la dejan las demás pruebas

    it('the first reading ingested after the seed is stored (it must NOT collide with an id of the seed and vanish)', async () => {
      await reload(1);
      const r = await post(batch(0));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ accepted: DEVICES.length, duplicates: 0 });
      const ids = (await prisma.iotReading.findMany({ where: { id: { gt: SEED_MAX_ID } }, select: { id: true } })).map((x) => x.id);
      expect(ids).toHaveLength(DEVICES.length);
      expect(await prisma.iotReading.count()).toBe(SEED_COUNT + DEVICES.length);
    });

    it('if the id sequence is ever behind the data, it fails LOUDLY (500) instead of silently dropping the readings', async () => {
      await reload(1);
      await prisma.$executeRawUnsafe('ALTER TABLE "iot_readings" ALTER COLUMN "id" RESTART WITH 5'); // atrasada a propósito: el id 5 ya existe
      const r = await post(batch(0));
      expect(r.status).toBe(500);
      expect(await extras()).toBe(0);
    });
  });

  describe('what the manager sees afterwards', () => {
    it('the readings appear in the summary the dashboard reads, and the window grows by the new minutes', async () => {
      const get = (path: string) => request(app.getHttpServer()).get(path).set('Authorization', bearer(token(USERS.manager)));
      const before = (await get('/telemetry/summary')).body;
      await post(batch(0)); await post(batch(1));
      const after = (await get('/telemetry/summary')).body;
      expect(after.totals.readings).toBe(before.totals.readings + DEVICES.length * 2);
      expect(new Date(after.window.to).toISOString()).toBe(new Date(BASE + 60_000).toISOString());
      expect(after.window.from).toBe(before.window.from);
    });

    it('an ALERT sent by a sensor shows up as attention', async () => {
      const get = (path: string) => request(app.getHttpServer()).get(path).set('Authorization', bearer(token(USERS.manager)));
      const b = batch(5, 1); b.readings[0].status = 'ALERT'; b.readings[0].note = 'prueba de ingesta';
      await post(b);
      const s = (await get('/telemetry/summary')).body;
      expect(s.totals.alerts).toBeGreaterThanOrEqual(1);
      expect(s.attention.some((a: any) => a.note === 'prueba de ingesta' && a.status === 'ALERT' && a.deviceId === DEVICES[0].id)).toBe(true);
    });
  });
});
