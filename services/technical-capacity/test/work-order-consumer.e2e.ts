import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, connect } from 'amqplib';
import { resetState } from './helpers';

process.env.CONSUMER_ENABLED = 'true';
process.env.RELAY_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';
const EXCHANGE = 'erp.events';
const KEY = 'ops.workorder.closed';
const QUEUE = 'q.capacity.workorders';
const DLQ = 'q.capacity.workorders.dlq';

const closed = (orderId: string | undefined, over: any = {}, data: any = {}) => ({
  eventId: randomUUID(), type: 'WorkOrderClosed', occurredAt: new Date().toISOString(), correlationId: 'corr-12345678',
  data: { ...(orderId ? { orderId } : {}), orderNumber: 'OT-0007', orderType: 'preventive', outcome: 'done', targetName: 'Switch piso 2', ...data }, ...over,
});

describe('WorkOrderClosed consumer: closing or cancelling an order frees its capacity (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication; let conn: Awaited<ReturnType<typeof connect>>; let ch: Channel;
  const prisma = new PrismaClient();
  const pub = (body: unknown, raw = false) => ch.publish(EXCHANGE, KEY, raw ? (body as Buffer) : Buffer.from(JSON.stringify(body)), { persistent: true, contentType: 'application/json' });
  const until = async (cond: () => Promise<boolean>, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const dlq = async () => (await ch.checkQueue(DLQ)).messageCount;
  const maint = async (orderId: string) => {
    const eng = (await prisma.engineer.findFirstOrThrow()).id;
    await prisma.$executeRawUnsafe(`INSERT INTO allocations (engineer_id, project_name, percent, start_date, end_date, kind, work_order_id) VALUES ('${eng}', 'OT-0007 · Switch', 20, '2026-11-02', '2026-11-03', 'maintenance', '${orderId}')`);
  };
  const has = async (orderId: string) => (await prisma.allocation.count({ where: { workOrderId: orderId } })) > 0;

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init();
    conn = await connect(process.env.RABBITMQ_URL as string); ch = await conn.createChannel();
    const exists = async () => { const c = await conn.createChannel(); c.on('error', () => { /* 404 esperado mientras la cola no existe */ }); try { await c.checkQueue(QUEUE); await c.close(); return true; } catch { return false; } };
    expect(await until(exists)).toBe(true);
  });
  beforeEach(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); });
  afterAll(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); await ch.close(); await conn.close(); await app.close(); await prisma.$disconnect(); });

  it('frees the capacity of the order when it is done or cancelled, only that order', async () => {
    const a = randomUUID(), b = randomUUID(), c = randomUUID(); await maint(a); await maint(b); await maint(c);
    pub(closed(a)); pub(closed(b, {}, { outcome: 'cancelled' }));
    expect(await until(async () => !(await has(a)) && !(await has(b)))).toBe(true); expect(await has(c)).toBe(true);
  });

  it('is idempotent: the same event 6 times, an order with nothing reserved, and an old event without orderId are acknowledged without error', async () => {
    const a = randomUUID(); await maint(a); const e = closed(a);
    for (let i = 0; i < 6; i++) pub(e);
    pub(closed(randomUUID())); pub(closed(undefined));
    const marker = randomUUID(); await maint(marker); pub(closed(marker));
    expect(await until(async () => !(await has(marker)))).toBe(true); expect(await has(a)).toBe(false); expect(await dlq()).toBe(0);
  });

  it('invalid events go to the dead-letter queue and free nothing; the consumer keeps living', async () => {
    const keep = randomUUID(); await maint(keep); const dead = await dlq();
    const bad = [closed(keep, { type: 'Other' }), closed('not-a-uuid'), closed(keep, {}, { outcome: 'lost' }), closed(keep, { eventId: 'x' }), closed(keep, { occurredAt: 'ayer' }), closed(keep, { correlationId: 'a' }), closed(keep, { data: 5 })];
    for (const b of bad) pub(b); pub(Buffer.from('{no json'), true);
    expect(await until(async () => (await dlq()) === dead + bad.length + 1)).toBe(true); expect(await has(keep)).toBe(true);
    const ok = randomUUID(); await maint(ok); pub(closed(ok)); expect(await until(async () => !(await has(ok)))).toBe(true);
  });

  it('CONCURRENCY: 40 orders closed at once free exactly those 40', async () => {
    const ids = Array.from({ length: 40 }, () => randomUUID()); for (const id of ids) await maint(id);
    const stay = randomUUID(); await maint(stay);
    for (const id of ids) pub(closed(id));
    expect(await until(async () => (await prisma.allocation.count({ where: { kind: 'maintenance' } })) === 1, 30_000)).toBe(true); expect(await has(stay)).toBe(true); expect(await dlq()).toBe(0);
  }, 60_000);
});
