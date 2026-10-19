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
    await ch.bindQueue(q.queue, 'erp.events', 'project.milestone.approved');
    await ch.consume(q.queue, (m) => { if (m) { received.push(m); ch.ack(m); } });
    await resetState(prisma);
    const { createApp } = require('../src/app.factory');
    app = await createApp();
    await app.init();
  });
  afterAll(async () => { await resetState(prisma); await app.close(); await ch.close(); await conn.close(); await prisma.$disconnect(); });
  beforeEach(async () => { received = []; await resetState(prisma); });

  const waitFor = async (n: number, ms = 8000) => {
    const end = Date.now() + ms;
    while (received.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  };

  it('publishes the approved event with persistence, ids and correlation id, then marks it published', async () => {
    const res = await request(app.getHttpServer()).post('/milestones/m5/approve').set('Authorization', bearer(token(USERS.lead))).set('x-correlation-id', 'trace-relay-0001');
    expect(res.status).toBe(200);
    await waitFor(1);
    expect(received).toHaveLength(1);
    const msg = received[0];
    const body = JSON.parse(msg.content.toString());
    expect(msg.fields.routingKey).toBe('project.milestone.approved');
    expect(msg.properties.deliveryMode).toBe(2); // persistente: sobrevive a un reinicio de RabbitMQ
    expect(msg.properties.messageId).toBe(res.body.eventId);
    expect(msg.properties.headers?.['x-correlation-id']).toBe('trace-relay-0001');
    expect(body).toMatchObject({ eventId: res.body.eventId, type: 'MilestoneApproved', correlationId: 'trace-relay-0001', data: { milestoneId: 'm5', projectName: 'Retail POS integration', amountCop: 14_200_000, approvedBy: USERS.lead.email } });
    // La marca se guarda al confirmar la transacción del relay, un instante DESPUÉS de que el mensaje llega: se espera, no se lee de inmediato.
    const end = Date.now() + 5000;
    let row = await prisma.outboxEvent.findUnique({ where: { id: res.body.eventId } });
    while (row?.publishedAt == null && Date.now() < end) { await new Promise((r) => setTimeout(r, 25)); row = await prisma.outboxEvent.findUnique({ where: { id: res.body.eventId } }); }
    expect(row?.publishedAt).not.toBeNull();
  });

  it('does not publish the same event twice', async () => {
    await request(app.getHttpServer()).post('/milestones/m6/approve').set('Authorization', bearer(token(USERS.lead)));
    await waitFor(1);
    await new Promise((r) => setTimeout(r, 1000)); // varias vueltas del relay
    expect(received).toHaveLength(1);
  });

  it('publishes a burst of different approvals, one message each', async () => {
    await Promise.all(['m2', 'm3', 'm5', 'm6'].map((id) => request(app.getHttpServer()).post(`/milestones/${id}/approve`).set('Authorization', bearer(token(USERS.lead)))));
    await waitFor(4);
    await new Promise((r) => setTimeout(r, 500));
    expect(received.map((m) => JSON.parse(m.content.toString()).data.milestoneId).sort()).toEqual(['m2', 'm3', 'm5', 'm6']);
  });

  it('a rejected approval (403) publishes nothing', async () => {
    await request(app.getHttpServer()).post('/milestones/m2/approve').set('Authorization', bearer(token(USERS.sales)));
    await new Promise((r) => setTimeout(r, 800));
    expect(received).toHaveLength(0);
  });
});
