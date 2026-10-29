import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, connect } from 'amqplib';
import { PrismaEventUnitOfWork } from '../src/infrastructure/prisma-event-uow';
import { resetState } from './helpers';

process.env.CONSUMER_ENABLED = 'true';
process.env.RATE_LIMIT = '100000';
const EXCHANGE = 'erp.events', QUEUE = 'q.notifications', DLQ = 'q.notifications.dlq';

const env = (type: string, data: any, over: any = {}) => ({ eventId: randomUUID(), type, occurredAt: new Date().toISOString(), correlationId: 'trace-nt-0001', data, ...over });
const overdue = (n = 1, data: any = {}) => env('OverdueDetected', { invoiceNumber: 'INV-0103', milestoneId: `t${n}`, projectName: 'Branch network upgrade', milestoneName: `Milestone ${n}`,
  amountCop: 1_000_000, taxCop: 190_000, totalCop: 1_190_000, dueDate: '2026-10-20T15:00:00.000Z', daysOverdue: 9, ...data });
const threshold = (data: any = {}) => env('ThresholdBreached', { deviceName: 'Cold room sensor', location: 'Bogotá', readingKind: 'temperature', status: 'ALERT', value: 31.5, unit: '°C', ...data });
const allocation = (data: any = {}) => env('OverAllocationDetected', { engineerName: 'Ing. Example', allocationPercent: 120, periodStart: '2026-11-01', periodEnd: '2026-11-30', ...data });

describe('notifications consumer (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  const toQueue = (b: unknown, raw = false) => ch.sendToQueue(QUEUE, raw ? (b as Buffer) : Buffer.from(JSON.stringify(b)), { persistent: true, contentType: 'application/json' });
  const waitUntil = async (cond: () => boolean | Promise<boolean>, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  const count = () => prisma.notification.count();
  const dlq = async () => (await ch.checkQueue(DLQ)).messageCount;

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory');
    app = await createApp(); await app.init();
    conn = await connect(process.env.RABBITMQ_URL as string); ch = await conn.createChannel();
    const exists = async () => { const c = await conn.createChannel(); c.on('error', () => undefined); try { await c.checkQueue(QUEUE); await c.close(); return true; } catch { return false; } };
    expect(await waitUntil(exists)).toBe(true);
  });
  beforeEach(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); });
  afterAll(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); await ch.close(); await conn.close(); await app.close(); await prisma.$disconnect(); });

  it('an OverdueDetected published to the exchange with the real routing key becomes one notification for billing and management', async () => {
    const e = overdue(1);
    ch.publish(EXCHANGE, 'billing.invoice.overdue', Buffer.from(JSON.stringify(e)), { persistent: true });
    expect(await waitUntil(async () => (await count()) === 1)).toBe(true);
    const n = await prisma.notification.findFirstOrThrow();
    expect(n).toMatchObject({ eventId: e.eventId, kind: 'OverdueDetected', severity: 'warning', audienceRoles: ['billing_analyst', 'manager'], correlationId: 'trace-nt-0001' });
    expect(n.params).toEqual({ invoiceNumber: 'INV-0103', projectName: 'Branch network upgrade', milestoneName: 'Milestone 1', totalCop: 1_190_000, daysOverdue: 9 });
  });

  it('the other two kinds arrive by their routing keys too', async () => {
    ch.publish(EXCHANGE, 'ops.threshold.breached', Buffer.from(JSON.stringify(threshold())), { persistent: true });
    ch.publish(EXCHANGE, 'capacity.overallocation.detected', Buffer.from(JSON.stringify(allocation())), { persistent: true });
    expect(await waitUntil(async () => (await count()) === 2)).toBe(true);
    expect((await prisma.notification.findMany({ orderBy: { kind: 'asc' } })).map((n) => [n.kind, n.severity, n.audienceRoles])).toEqual([
      ['OverAllocationDetected', 'warning', ['manager', 'sales']], ['ThresholdBreached', 'critical', ['manager']]]);
  });

  it('a repeated delivery of the same event creates a single notification', async () => {
    const e = overdue(2); toQueue(e); toQueue(e); toQueue(e);
    expect(await waitUntil(async () => (await prisma.processedEvent.count()) === 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    expect(await count()).toBe(1);
    expect(await dlq()).toBe(0); // un duplicado se confirma sin error: no llega a la cola de mensajes muertos
  });

  it('many different events are all kept, and the same events delivered twice add nothing', async () => {
    const events = Array.from({ length: 20 }, (_, i) => overdue(100 + i));
    events.forEach((e) => toQueue(e)); events.forEach((e) => toQueue(e));
    expect(await waitUntil(async () => (await count()) === 20)).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    expect(await count()).toBe(20); expect(await prisma.processedEvent.count()).toBe(20);
  });

  it('invalid messages go to the dead-letter queue and create nothing, and the next good one still works', async () => {
    toQueue(Buffer.from('{ not json'), true);
    toQueue({ ...overdue(3), type: 'Nope' });
    toQueue(overdue(4, { daysOverdue: 0 }) as any);
    toQueue(threshold({ value: 'hot' }) as any);
    expect(await waitUntil(async () => (await dlq()) === 4)).toBe(true);
    expect(await count()).toBe(0);
    toQueue(overdue(5));
    expect(await waitUntil(async () => (await count()) === 1)).toBe(true);
  });

  it('a message over 16 KB is refused to the dead-letter queue', async () => {
    toQueue(Buffer.from(JSON.stringify({ ...overdue(6), pad: 'x'.repeat(20_000) })), true);
    expect(await waitUntil(async () => (await dlq()) === 1)).toBe(true);
    expect(await count()).toBe(0);
  });

  it('a short database outage does not lose the notification: it is retried with the message still unconfirmed, and nothing reaches the dead-letter queue', async () => {
    const real = PrismaEventUnitOfWork.prototype.run; let fails = 2;
    const spy = jest.spyOn(PrismaEventUnitOfWork.prototype, 'run').mockImplementation(function (this: any, work: any) {
      if (fails-- > 0) return Promise.reject(new Error('connection refused (simulated outage)'));
      return real.call(this, work);
    });
    try {
      toQueue(overdue(7));
      expect(await waitUntil(async () => (await count()) === 1)).toBe(true);
      expect(await dlq()).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it('an outage that outlasts the retries sends the message to the dead-letter queue (not lost, not looping)', async () => {
    const spy = jest.spyOn(PrismaEventUnitOfWork.prototype, 'run').mockRejectedValue(new Error('database is down (simulated)'));
    try {
      toQueue(overdue(8));
      expect(await waitUntil(async () => (await dlq()) === 1)).toBe(true);
      expect(await count()).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it('if RabbitMQ cancels the consumer (queue deleted) the service reconnects by itself and keeps consuming', async () => {
    await ch.deleteQueue(QUEUE); // RabbitMQ cancela el consumo: antes el servicio quedaba mudo
    const back = async () => { const c = await conn.createChannel(); c.on('error', () => undefined); try { await c.checkQueue(QUEUE); await c.close(); return true; } catch { return false; } };
    expect(await waitUntil(back, 20_000)).toBe(true);
    toQueue(overdue(9));
    expect(await waitUntil(async () => (await count()) === 1, 15_000)).toBe(true);
  });
});
