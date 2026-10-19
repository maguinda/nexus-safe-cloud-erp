import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, ConsumeMessage, connect } from 'amqplib';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

// Flujo completo de billing: MilestoneApproved entra -> borrador + InvoiceDrafted en el outbox -> el relay lo publica;
// emitir -> InvoiceIssued. Consumidor y relay activos, contra PostgreSQL y RabbitMQ reales.
process.env.CONSUMER_ENABLED = 'true';
process.env.RELAY_ENABLED = 'true';
process.env.OUTBOX_POLL_MS = '100';
process.env.RATE_LIMIT = '100000';

describe('billing outbox relay -> RabbitMQ (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  let received: ConsumeMessage[] = [];
  const waitUntil = async (cond: () => boolean | Promise<boolean>, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  const approved = (n: number) => ({
    eventId: randomUUID(), type: 'MilestoneApproved', occurredAt: new Date().toISOString(), correlationId: `trace-relay-${String(n).padStart(4, '0')}`,
    data: { milestoneId: `r${n}`, milestoneName: `Milestone ${n}`, projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 2_000_000, approvedBy: 'laura.rios@nexus.example' },
  });

  // Directo a la cola (no por el exchange): la cola existe antes de quedar vinculada y un mensaje publicado en ese instante se perdería.
  const toQueue = (body: unknown) => ch.sendToQueue('q.billing', Buffer.from(JSON.stringify(body)), { persistent: true });

  beforeAll(async () => {
    conn = await connect(process.env.RABBITMQ_URL as string);
    ch = await conn.createChannel();
    await ch.assertExchange('erp.events', 'topic', { durable: true });
    const q = await ch.assertQueue('', { exclusive: true });
    await ch.bindQueue(q.queue, 'erp.events', 'billing.invoice.*');
    await ch.consume(q.queue, (m) => { if (m) { received.push(m); ch.ack(m); } });
    await resetState(prisma);
    const { createApp } = require('../src/app.factory');
    app = await createApp();
    await app.init();
    // el consumidor crea su cola al arrancar; con un RabbitMQ nuevo hay que esperarla antes de publicar
    await waitUntil(async () => { const c = await conn.createChannel(); c.on('error', () => undefined); try { await c.checkQueue('q.billing'); await c.close(); return true; } catch { return false; } });
  });
  afterAll(async () => { await resetState(prisma); await app.close(); await ch.close(); await conn.close(); await prisma.$disconnect(); });
  beforeEach(async () => { received = []; await ch.purgeQueue('q.billing'); await resetState(prisma); });

  it('publishes InvoiceDrafted with persistence, ids and the ORIGINAL correlation id, then marks it published', async () => {
    const e = approved(1);
    toQueue(e);
    expect(await waitUntil(() => received.length >= 1)).toBe(true);
    const msg = received[0];
    const body = JSON.parse(msg.content.toString());
    expect(msg.fields.routingKey).toBe('billing.invoice.drafted');
    expect(msg.properties.deliveryMode).toBe(2);
    expect(msg.properties.type).toBe('InvoiceDrafted');
    expect(msg.properties.headers?.['x-correlation-id']).toBe(e.correlationId);
    expect(body).toMatchObject({ type: 'InvoiceDrafted', correlationId: e.correlationId, data: { invoiceNumber: 'INV-0103', milestoneId: 'r1', amountCop: 2_000_000, taxCop: 380_000, totalCop: 2_380_000, approvedBy: 'laura.rios@nexus.example' } });
    expect(msg.properties.messageId).toBe(body.eventId);
    // La marca se guarda al confirmar la transacción, un instante DESPUÉS de que llega el mensaje: se espera, no se lee de inmediato.
    expect(await waitUntil(async () => (await prisma.outboxEvent.findUnique({ where: { id: body.eventId } }))?.publishedAt != null)).toBe(true);
  });

  it('publishes InvoiceIssued when an analyst issues the draft, and nothing twice', async () => {
    toQueue(approved(2));
    expect(await waitUntil(() => received.length >= 1)).toBe(true);
    received = [];
    const res = await request(app.getHttpServer()).patch('/invoices/INV-0103/issue').set('Authorization', bearer(token(USERS.billing))).set('x-correlation-id', 'trace-issue-0001');
    expect(res.status).toBe(200);
    expect(await waitUntil(() => received.length >= 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 800)); // si se repitiera, llegaría en este lapso
    expect(received).toHaveLength(1);
    const body = JSON.parse(received[0].content.toString());
    expect(received[0].fields.routingKey).toBe('billing.invoice.issued');
    expect(body).toMatchObject({ type: 'InvoiceIssued', correlationId: 'trace-issue-0001', data: { invoiceNumber: 'INV-0103', totalCop: 2_380_000, issuedBy: USERS.billing.email } });
  });

  it('a rejected issue (403 or 409) publishes nothing', async () => {
    await request(app.getHttpServer()).patch('/invoices/INV-0101/issue').set('Authorization', bearer(token(USERS.billing))); // ya emitida: 409
    await request(app.getHttpServer()).patch('/invoices/INV-0101/issue').set('Authorization', bearer(token(USERS.sales))); // sales: 403
    await new Promise((r) => setTimeout(r, 800));
    expect(received).toHaveLength(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });
});
