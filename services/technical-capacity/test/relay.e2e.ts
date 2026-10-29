import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, ConsumeMessage, connect } from 'amqplib';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.RELAY_ENABLED = 'true';
process.env.OUTBOX_POLL_MS = '100';
process.env.RATE_LIMIT = '100000';

describe('outbox relay -> RabbitMQ (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  let received: ConsumeMessage[] = [];

  beforeAll(async () => {
    conn = await connect(process.env.RABBITMQ_URL as string);
    ch = await conn.createChannel();
    await ch.assertExchange('erp.events', 'topic', { durable: true });
    const q = await ch.assertQueue('', { exclusive: true });
    await ch.bindQueue(q.queue, 'erp.events', 'capacity.#');
    await ch.consume(q.queue, (m) => { if (m) { received.push(m); ch.ack(m); } });
    await resetState(prisma);
    const { createApp } = require('../src/app.factory');
    app = await createApp(); await app.init();
  });
  afterAll(async () => { await resetState(prisma); await app.close(); await ch.close(); await conn.close(); await prisma.$disconnect(); });
  beforeEach(async () => { received = []; await resetState(prisma); });

  const waitFor = async (n: number, ms = 8000) => { const end = Date.now() + ms; while (received.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
  const manager = () => bearer(token(USERS.manager));

  it('an allocation over 100% (allowed by the manager) publishes EngineerAllocated and OverAllocationDetected, persistent, with ids and the correlation id, then marks them published', async () => {
    const id = (await request(app.getHttpServer()).post('/engineers').set('Authorization', manager()).send({ name: 'Relay Engineer', role: 'Tester' })).body.id;
    const post = (percent: number, extra: object = {}) => request(app.getHttpServer()).post(`/engineers/${id}/allocations`).set('Authorization', manager()).set('x-correlation-id', 'trace-relay-0001').send({ projectName: 'Branch network upgrade', percent, startDate: '2026-11-02', endDate: '2026-11-30', ...extra });
    await post(80); await post(50, { allowOverallocation: true });
    await waitFor(3);
    expect(received).toHaveLength(3);
    const byKey = (k: string) => received.filter((m) => m.fields.routingKey === k);
    expect(byKey('capacity.engineer.allocated')).toHaveLength(2);
    const over = byKey('capacity.overallocation.detected');
    expect(over).toHaveLength(1);
    expect(over[0].properties).toMatchObject({ deliveryMode: 2, contentType: 'application/json', type: 'OverAllocationDetected' });
    expect(over[0].properties.headers).toMatchObject({ 'x-correlation-id': 'trace-relay-0001' });
    const body = JSON.parse(over[0].content.toString());
    expect(body).toMatchObject({ type: 'OverAllocationDetected', correlationId: 'trace-relay-0001', data: { engineerName: 'Relay Engineer', allocationPercent: 130, periodStart: '2026-11-02', periodEnd: '2026-11-30' } });
    expect(body.eventId).toBe(over[0].properties.messageId);
    for (let i = 0; i < 40 && (await prisma.outboxEvent.count({ where: { publishedAt: null } })) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it('the over-allocation event has exactly the fields the Notifications service requires (integer over 100, text, YYYY-MM-DD dates)', async () => {
    const id = (await request(app.getHttpServer()).post('/engineers').set('Authorization', manager()).send({ name: 'Contract Engineer', role: 'Tester' })).body.id;
    const post = (percent: number, extra: object = {}) => request(app.getHttpServer()).post(`/engineers/${id}/allocations`).set('Authorization', manager()).send({ projectName: 'Project', percent, startDate: '2026-12-01', endDate: '2026-12-05', ...extra });
    await post(100); await post(1, { allowOverallocation: true });
    await waitFor(3);
    const body = JSON.parse(received.find((m) => m.fields.routingKey === 'capacity.overallocation.detected')!.content.toString());
    expect(Number.isInteger(body.data.allocationPercent) && body.data.allocationPercent > 100).toBe(true);
    for (const k of ['engineerName', 'periodStart', 'periodEnd']) expect(typeof body.data[k]).toBe('string');
    expect(body.data.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(body.data.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.correlationId).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
  });
});
