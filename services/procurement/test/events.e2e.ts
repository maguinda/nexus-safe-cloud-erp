import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, ConsumeMessage, connect } from 'amqplib';
import request from 'supertest';
import { bearer, resetState, SEED_ITEMS, SEED_SUPPLIERS, token, USERS } from './helpers';

process.env.RELAY_ENABLED = 'true';
process.env.CONSUMER_ENABLED = 'true';
process.env.OUTBOX_POLL_MS = '100';
process.env.RATE_LIMIT = '100000';
const EXCHANGE = 'erp.events', QUEUE = 'q.procurement', DLQ = 'q.procurement.dlq';

const alert = (data: object = {}, over: object = {}) => ({ eventId: randomUUID(), type: 'ThresholdBreached', occurredAt: new Date().toISOString(), correlationId: 'trace-pr-0001',
  data: { deviceId: 'TEMP_MON_OF1', deviceName: 'TEMP_MON_OF1', location: 'Medellín', readingKind: 'TEMP', status: 'ALERT', value: 31.5, unit: '°C', recordedAt: new Date().toISOString(), ...data }, ...over });

describe('procurement events (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  let received: ConsumeMessage[] = [];
  const toQueue = (b: unknown, raw = false) => ch.sendToQueue(QUEUE, raw ? (b as Buffer) : Buffer.from(JSON.stringify(b)), { persistent: true, contentType: 'application/json' });
  const waitUntil = async (cond: () => boolean | Promise<boolean>, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  const dlq = async () => (await ch.checkQueue(DLQ)).messageCount;

  beforeAll(async () => {
    conn = await connect(process.env.RABBITMQ_URL as string); ch = await conn.createChannel();
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
    const q = await ch.assertQueue('', { exclusive: true });
    await ch.bindQueue(q.queue, EXCHANGE, 'procurement.#');
    await ch.consume(q.queue, (m) => { if (m) { received.push(m); ch.ack(m); } });
    const { createApp } = require('../src/app.factory');
    app = await createApp(); await app.init();
    const exists = async () => { const c = await conn.createChannel(); c.on('error', () => undefined); try { await c.checkQueue(QUEUE); await c.close(); return true; } catch { return false; } };
    expect(await waitUntil(exists)).toBe(true);
  });
  beforeEach(async () => { received = []; await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); });
  afterAll(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); await app.close(); await ch.close(); await conn.close(); await prisma.$disconnect(); });

  it('receiving an equipment order publishes StockChanged and EquipmentPurchased to RabbitMQ (persistent, with ids and the correlation id) and marks them published', async () => {
    const auth = bearer(token(USERS.manager));
    const o = await request(app.getHttpServer()).post('/orders').set('Authorization', auth).send({ supplierId: SEED_SUPPLIERS[0], itemId: SEED_ITEMS[2], quantity: 2, unitPriceCop: 3_000_000 });
    await request(app.getHttpServer()).post(`/orders/${o.body.id}/receive`).set('Authorization', auth).set('x-correlation-id', 'trace-pr-0002');
    expect(await waitUntil(() => received.length === 2)).toBe(true);
    expect(received.map((m) => m.fields.routingKey).sort()).toEqual(['procurement.equipment.purchased', 'procurement.stock.changed']);
    for (const m of received) {
      expect(m.properties).toMatchObject({ deliveryMode: 2, contentType: 'application/json' });
      const body = JSON.parse(m.content.toString());
      expect(body.eventId).toBe(m.properties.messageId); expect(body.correlationId).toBe('trace-pr-0002');
    }
    expect(await waitUntil(async () => (await prisma.outboxEvent.count({ where: { publishedAt: null } })) === 0)).toBe(true);
  });

  it('a ThresholdBreached from operations becomes a suggestion: the spare parts that serve that measure come back, those in stock first; a repeated delivery adds nothing', async () => {
    const e = alert(); toQueue(e); toQueue(e);
    expect(await waitUntil(async () => (await prisma.alertSuggestion.count()) === 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
    expect(await prisma.alertSuggestion.count()).toBe(1); expect(await dlq()).toBe(0);
    const r = await request(app.getHttpServer()).get('/inventory/suggestions').set('Authorization', bearer(token(USERS.lead)));
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ deviceName: 'TEMP_MON_OF1', location: 'Medellín', readingKind: 'TEMP', status: 'ALERT', value: 31.5, unit: '°C' });
    expect(r.body[0].items.map((i: any) => [i.name, i.onHand])).toEqual([['Sensor de temperatura TH-10', 8]]); // la fuente de poder sirve para POWER, no para TEMP
  });

  it('an alert for a measure no spare part serves still shows, with no suggestions', async () => {
    toQueue(alert({ readingKind: 'SMOKE', deviceName: 'SMOKE_1' }));
    expect(await waitUntil(async () => (await prisma.alertSuggestion.count()) === 1)).toBe(true);
    const r = await request(app.getHttpServer()).get('/inventory/suggestions').set('Authorization', bearer(token(USERS.manager)));
    expect(r.body[0]).toMatchObject({ readingKind: 'SMOKE', items: [] });
  });

  it('invalid messages go to the dead-letter queue and change nothing; the next good one still works', async () => {
    toQueue(Buffer.from('{ no json'), true);
    toQueue({ ...alert(), type: 'Nope' });
    toQueue(alert({ value: 'hot' }));
    toQueue(alert({ value: 1e12 }));
    expect(await waitUntil(async () => (await dlq()) === 4)).toBe(true);
    expect(await prisma.alertSuggestion.count()).toBe(0);
    toQueue(alert());
    expect(await waitUntil(async () => (await prisma.alertSuggestion.count()) === 1)).toBe(true);
  });

  it('only the last 200 alerts are kept', async () => {
    for (let i = 0; i < 205; i++) toQueue(alert({ deviceName: `DEV_${i}` }));
    expect(await waitUntil(async () => (await prisma.processedEvent.count()) === 205, 30_000)).toBe(true);
    expect(await prisma.alertSuggestion.count()).toBeLessThanOrEqual(201);
  }, 60_000);
});
