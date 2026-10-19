import { randomUUID } from 'crypto';
import { Channel, connect } from 'amqplib';
import { DLQ, DLX, EXCHANGE, MilestoneApprovedConsumer, QUEUE, ROUTING_KEY } from '../src/infrastructure/milestone-approved-consumer';

// Regresión: mensajes que YA esperan en la cola cuando el consumidor arranca (p. ej. billing estuvo caído y los eventos
// esperaron). RabbitMQ los entrega en cuanto se registra el consumo; ninguno puede perderse ni quedar sin confirmar.
describe('MilestoneApprovedConsumer with a backlog already waiting (e2e, real RabbitMQ)', () => {
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  const waitUntil = async (cond: () => boolean | Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
  const body = (n: number) => ({ eventId: randomUUID(), type: 'MilestoneApproved', occurredAt: new Date().toISOString(), correlationId: `backlog-${String(n).padStart(6, '0')}`, data: { milestoneId: `b${n}`, milestoneName: 'M', projectId: 'p1', projectName: 'P', amountCop: 1000, approvedBy: 'laura.rios@nexus.example' } });
  const counts = async () => { const c = await conn.createChannel(); c.on('error', () => undefined); const q = await c.checkQueue(QUEUE); await c.close(); return { ready: q.messageCount }; };
  const unacked = async () => { const r = await fetch(`http://${new URL(process.env.RABBITMQ_URL as string).hostname}:15672/api/queues/%2F/${QUEUE}`, { headers: { authorization: `Basic ${Buffer.from(new URL(process.env.RABBITMQ_URL as string).username + ':' + decodeURIComponent(new URL(process.env.RABBITMQ_URL as string).password)).toString('base64')}` } }); return (await r.json() as any).messages_unacknowledged as number; };

  beforeAll(async () => {
    conn = await connect(process.env.RABBITMQ_URL as string);
    ch = await conn.createChannel();
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
    await ch.assertExchange(DLX, 'direct', { durable: true });
    await ch.assertQueue(DLQ, { durable: true });
    await ch.bindQueue(DLQ, DLX, QUEUE);
    await ch.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': DLX, 'x-dead-letter-routing-key': QUEUE } });
    await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  });
  afterAll(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await ch.close(); await conn.close(); });
  beforeEach(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); });

  it.each([1, 5, 25])('processes and confirms all %i messages that were already waiting when the consumer starts', async (n) => {
    const processed: string[] = [];
    const useCase: any = { execute: async (b: any) => { processed.push(b.data.milestoneId); return 'created'; } };
    for (let i = 1; i <= n; i++) ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(body(i))), { persistent: true, contentType: 'application/json' });
    expect(await waitUntil(async () => (await counts()).ready === n)).toBe(true); // el backlog ya está en la cola
    const consumer = new MilestoneApprovedConsumer(useCase, process.env.RABBITMQ_URL as string);
    consumer.start();
    try {
      expect(await waitUntil(() => processed.length === n)).toBe(true);
      expect(new Set(processed).size).toBe(n);
      expect(await waitUntil(async () => (await unacked()) === 0 && (await counts()).ready === 0)).toBe(true); // todos confirmados, ninguno colgado
    } finally { await consumer.stop(); }
  });
});
