import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { Channel, ConsumeMessage, connect } from 'amqplib';
import request from 'supertest';
import { loadIot } from '../prisma/iot-load';

process.env.RELAY_ENABLED = 'true';
process.env.OUTBOX_POLL_MS = '100';
process.env.RATE_LIMIT = '100000';
const KEY = randomBytes(24).toString('hex');
process.env.INGEST_KEY = KEY;
const T0 = Date.UTC(2026, 9, 21, 10, 0);

describe('outbox relay -> RabbitMQ (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  let received: ConsumeMessage[] = [];
  const cleanup = async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.iotReading.deleteMany({ where: { id: { gt: 4200 } } });
    await prisma.iotDevice.updateMany({ data: { alertState: 'normal', alertStateAt: new Date(T0 - 60_000) } });
  };

  beforeAll(async () => {
    conn = await connect(process.env.RABBITMQ_URL as string);
    ch = await conn.createChannel();
    await ch.assertExchange('erp.events', 'topic', { durable: true });
    const q = await ch.assertQueue('', { exclusive: true });
    await ch.bindQueue(q.queue, 'erp.events', 'ops.#');
    await ch.consume(q.queue, (m) => { if (m) { received.push(m); ch.ack(m); } });
    const { createApp } = require('../src/app.factory');
    app = await createApp(); await app.init(); await loadIot(prisma); await cleanup();
  });
  afterAll(async () => { await cleanup(); await app.close(); await ch.close(); await conn.close(); await prisma.$disconnect(); });
  beforeEach(async () => { received = []; await cleanup(); });
  const waitFor = async (n: number, ms = 8000) => { const end = Date.now() + ms; while (received.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };

  it('a sensor going into ALERT publishes ThresholdBreached to ops.threshold.breached with the shape Notifications requires, then marks it published', async () => {
    const d = await prisma.iotDevice.findFirstOrThrow({ where: { unit: '°C' } });
    const r = await request(app.getHttpServer()).post('/telemetry/readings').set('x-ingest-key', KEY).set('x-correlation-id', 'trace-ops-0001')
      .send({ readings: [{ deviceId: d.id, recordedAt: new Date(T0).toISOString(), status: 'ALERT', value: 31.5, unit: d.unit }] });
    expect(r.status).toBe(200);
    await waitFor(1);
    expect(received).toHaveLength(1);
    const m = received[0];
    expect(m.fields.routingKey).toBe('ops.threshold.breached');
    expect(m.properties).toMatchObject({ deliveryMode: 2, contentType: 'application/json', type: 'ThresholdBreached' });
    const body = JSON.parse(m.content.toString());
    expect(body.eventId).toBe(m.properties.messageId);
    expect(body.correlationId).toBe('trace-ops-0001');
    // Lo que valida Notifications (services/notifications/src/domain/events.ts): textos acotados, valor numérico finito y estado ALERT/WARNING.
    const x = body.data;
    expect(typeof x.deviceName === 'string' && x.deviceName.length >= 1 && x.deviceName.length <= 120).toBe(true);
    expect(typeof x.location === 'string' && x.location.length <= 120).toBe(true);
    expect(typeof x.readingKind === 'string' && x.readingKind.length <= 60).toBe(true);
    expect(['ALERT', 'WARNING']).toContain(x.status);
    expect(Number.isFinite(x.value) && Math.abs(x.value) <= 1e9).toBe(true);
    expect(typeof x.unit === 'string' && x.unit.length >= 1 && x.unit.length <= 20).toBe(true);
    expect(body.correlationId).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    for (let i = 0; i < 40 && (await prisma.outboxEvent.count({ where: { publishedAt: null } })) > 0; i++) await new Promise((r2) => setTimeout(r2, 100));
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it('a normal reading publishes nothing', async () => {
    const d = await prisma.iotDevice.findFirstOrThrow({ where: { unit: '°C' } });
    await request(app.getHttpServer()).post('/telemetry/readings').set('x-ingest-key', KEY).send({ readings: [{ deviceId: d.id, recordedAt: new Date(T0).toISOString(), status: 'NORMAL', value: 21, unit: d.unit }] });
    await new Promise((r) => setTimeout(r, 800));
    expect(received).toHaveLength(0);
  });
  it('real RabbitMQ: a mandatory publish to a key with no queue is RETURNED before the confirmation (the assumption the relay relies on), and a routable one is not', async () => {
    const ex = `relay.probe.${Date.now()}`;
    const c2 = await conn.createConfirmChannel();
    await c2.assertExchange(ex, 'topic', { autoDelete: true });
    const order: string[] = [];
    c2.on('return', () => order.push('return'));
    await new Promise<void>((res, rej) => c2.publish(ex, 'nobody.listens', Buffer.from('{}'), { mandatory: true, messageId: 'p1' }, (e) => { order.push('confirm'); e ? rej(e) : res(); }));
    expect(order).toEqual(['return', 'confirm']);
    const q = await c2.assertQueue('', { exclusive: true }); await c2.bindQueue(q.queue, ex, 'somebody.#');
    order.length = 0;
    await new Promise<void>((res, rej) => c2.publish(ex, 'somebody.listens', Buffer.from('{}'), { mandatory: true, messageId: 'p2' }, (e) => { order.push('confirm'); e ? rej(e) : res(); }));
    expect(order).toEqual(['confirm']);
    await c2.close();
  });

  it('compaction empties the payload of events published more than N days ago, keeps the row and its unique key, and leaves recent and pending events alone', async () => {
    const { OutboxRelay } = require('../src/infrastructure/outbox-relay');
    const mk = (n: string, published: Date | null) => prisma.outboxEvent.create({ data: { id: require('crypto').randomUUID(), aggregateId: `compact-${n}`, type: 'T', routingKey: 'ops.x', payload: { type: 'T', data: { secret: n } }, publishedAt: published } });
    const day = 86_400_000;
    const old = await mk('old', new Date(Date.now() - 40 * day)); const recent = await mk('recent', new Date(Date.now() - 2 * day)); const pending = await mk('pending', null);
    const relay = new OutboxRelay(prisma, { url: process.env.RABBITMQ_URL as string, pollMs: 100 });
    expect(await relay.compact(30)).toBe(1);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: old.id } })).payload).toEqual({ compacted: true });
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: recent.id } })).payload).toMatchObject({ data: { secret: 'recent' } });
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: pending.id } })).payload).toMatchObject({ data: { secret: 'pending' } });
    expect(await relay.compact(30)).toBe(0);
    // la fila sigue ahí: el mismo evento no puede volver a crearse
    await expect(mk('old', null)).rejects.toThrow();
  });
});
