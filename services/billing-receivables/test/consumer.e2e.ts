import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, connect } from 'amqplib';
import { resetState } from './helpers';

process.env.CONSUMER_ENABLED = 'true';
process.env.RELAY_ENABLED = 'false'; // aquí se mira el outbox; el relay se prueba en relay.e2e.ts
process.env.RATE_LIMIT = '100000';
const EXCHANGE = 'erp.events';
const ROUTING_KEY = 'project.milestone.approved';
const QUEUE = 'q.billing';
const DLQ = 'q.billing.dlq';

const event = (n: number | string, over: any = {}, data: any = {}) => ({
  eventId: randomUUID(), type: 'MilestoneApproved', occurredAt: new Date().toISOString(), correlationId: `corr-${String(n).padStart(8, '0')}`,
  data: { milestoneId: `t${n}`, milestoneName: `Milestone ${n}`, projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 1_000_000 + Number(n || 0), approvedBy: 'laura.rios@nexus.example', ...data },
  ...over,
});

describe('MilestoneApproved consumer (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  const publish = (body: unknown, raw = false) => ch.publish(EXCHANGE, ROUTING_KEY, raw ? (body as Buffer) : Buffer.from(JSON.stringify(body)), { persistent: true, contentType: 'application/json' });
  const waitUntil = async (cond: () => Promise<boolean>, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  const dlqCount = async () => (await ch.checkQueue(DLQ)).messageCount;
  const invoiceCount = () => prisma.invoice.count({ where: { number: { notIn: ['INV-0101', 'INV-0102'] } } });

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory');
    app = await createApp();
    await app.init(); // arranca el consumidor
    conn = await connect(process.env.RABBITMQ_URL as string);
    ch = await conn.createChannel();
    // Con un RabbitMQ recién creado la cola aún no existe: consultarla en el canal principal lo cerraría con un 404.
    // Se consulta en un canal desechable (con su propio manejo de error) hasta que el consumidor la cree.
    const queueExists = async () => { const c = await conn.createChannel(); c.on('error', () => { /* 404 esperado mientras la cola no existe */ }); try { await c.checkQueue(QUEUE); await c.close(); return true; } catch { return false; } };
    expect(await waitUntil(queueExists)).toBe(true);
  });
  beforeEach(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); });
  afterAll(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); await ch.close(); await conn.close(); await app.close(); await prisma.$disconnect(); });

  it('creates a draft invoice from a MilestoneApproved event', async () => {
    const e = event(1);
    publish(e);
    expect(await waitUntil(async () => (await invoiceCount()) === 1)).toBe(true);
    const inv = await prisma.invoice.findFirst({ where: { milestoneId: 't1' } });
    expect(inv).toMatchObject({ number: 'INV-0103', status: 'draft', amountCop: 1_000_001, taxCop: 190_000, totalCop: 1_190_001, approvedBy: 'laura.rios@nexus.example', projectName: 'Branch network upgrade', milestoneName: 'Milestone 1', sourceEventId: e.eventId, issuedAt: null, issuedBy: null });
    const out = await prisma.outboxEvent.findMany();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ aggregateId: 'INV-0103', type: 'InvoiceDrafted', routingKey: 'billing.invoice.drafted', publishedAt: null });
    expect(out[0].payload).toMatchObject({ type: 'InvoiceDrafted', correlationId: e.correlationId, data: { invoiceNumber: 'INV-0103', milestoneId: 't1', amountCop: 1_000_001, taxCop: 190_000, totalCop: 1_190_001, approvedBy: 'laura.rios@nexus.example' } });
  });

  it('ignores the same event delivered 20 times at once', async () => {
    const e = event(2);
    for (let i = 0; i < 20; i++) publish(e);
    expect(await waitUntil(async () => (await invoiceCount()) >= 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));
    expect(await invoiceCount()).toBe(1);
    expect(await prisma.processedEvent.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1); // un solo InvoiceDrafted, no 20
    expect(await dlqCount()).toBe(0);
  });

  it('creates one invoice per milestone even if the approval is replayed under new event ids', async () => {
    for (let i = 0; i < 6; i++) publish(event(3, {}, { milestoneId: 'replayed' }));
    expect(await waitUntil(async () => (await prisma.processedEvent.count()) === 6)).toBe(true);
    expect(await prisma.invoice.count({ where: { milestoneId: 'replayed' } })).toBe(1);
    expect(await dlqCount()).toBe(0);
  });

  it('sends malformed messages to the dead-letter queue, creates nothing, and keeps working', async () => {
    const poison: unknown[] = [
      Buffer.from('this is not json'),
      Buffer.from('[]'),
      Buffer.from('{"type":"MilestoneApproved"}'),
      Buffer.from(JSON.stringify(event(4, {}, { amountCop: -50 }))),
      Buffer.from(JSON.stringify(event(5, { eventId: "1'; DROP TABLE invoices;--" }))),
      Buffer.from(JSON.stringify(event(6, {}, { milestoneId: '../../etc/passwd' }))),
      Buffer.from(JSON.stringify(event(7, {}, { projectName: 'x'.repeat(100_000) }))),
    ];
    for (const p of poison) publish(p, true);
    expect(await waitUntil(async () => (await dlqCount()) === poison.length)).toBe(true);
    expect(await invoiceCount()).toBe(0);
    expect(await prisma.processedEvent.count()).toBe(0);
    publish(event(8)); // el consumidor sigue vivo después de los mensajes basura
    expect(await waitUntil(async () => (await invoiceCount()) === 1)).toBe(true);
  });

  it('turns 50 simultaneous different approvals into 50 invoices with unique consecutive numbers', async () => {
    for (let i = 1; i <= 50; i++) publish(event(100 + i));
    await waitUntil(async () => (await invoiceCount()) === 50, 20_000);
    expect({ invoices: await invoiceCount(), processed: await prisma.processedEvent.count(), dlq: await dlqCount(), queued: (await ch.checkQueue(QUEUE)).messageCount }).toEqual({ invoices: 50, processed: 50, dlq: 0, queued: 0 });
    const numbers = (await prisma.invoice.findMany({ where: { number: { notIn: ['INV-0101', 'INV-0102'] } }, select: { number: true } })).map((r) => r.number).sort();
    expect(new Set(numbers).size).toBe(50);
    expect(numbers[0]).toBe('INV-0103');
    expect(numbers[49]).toBe('INV-0152');
    expect(await dlqCount()).toBe(0);
  }, 40_000);

  describe('QuoteApproved: the approved quote becomes the contract of its project', () => {
    const QKEY = 'project.quote.approved';
    const qe = (n: number, over: any = {}, data: any = {}) => ({
      eventId: randomUUID(), type: 'QuoteApproved', occurredAt: '2026-11-02T15:00:00.000Z', correlationId: `corr-${String(n).padStart(8, '0')}`,
      data: { quoteId: randomUUID(), quoteNumber: `COT-${String(n).padStart(4, '0')}`, clientName: 'Acme S.A.S.', projectId: `p-q${n}`, projectName: `Red sede ${n}`, amountCop: 12_500_000, approvedBy: 'diana.vega@nexus.example', ...data }, ...over,
    });
    const pub = (body: unknown, raw = false) => ch.publish(EXCHANGE, QKEY, raw ? (body as Buffer) : Buffer.from(JSON.stringify(body)), { persistent: true, contentType: 'application/json' });
    const contracts = () => prisma.contract.findMany({ where: { quoteRef: { not: null } }, orderBy: { quoteRef: 'asc' } });

    it('creates the contract with the quote price, the project id, the approver and 365 days from the approval', async () => {
      pub(qe(7));
      expect(await waitUntil(async () => (await contracts()).length === 1)).toBe(true);
      const c = (await contracts())[0];
      expect(c).toMatchObject({ clientName: 'Acme S.A.S.', projectName: 'Red sede 7', projectId: 'p-q7', quoteRef: 'COT-0007', amountCop: 12_500_000, status: 'active', createdBy: 'diana.vega@nexus.example' });
      expect(c.startDate.toISOString().slice(0, 10)).toBe('2026-11-02'); expect(c.endDate.toISOString().slice(0, 10)).toBe('2027-11-02');
    });

    it('is idempotent: the same event 6 times, and the same quote with another event id, make one contract', async () => {
      const e = qe(8); for (let i = 0; i < 6; i++) pub(e);
      pub(qe(8, {}, { quoteId: e.data.quoteId, quoteNumber: 'COT-0008' }));
      pub(qe(9)); // un evento distinto detrás: cuando llega, los anteriores ya se procesaron
      expect(await waitUntil(async () => (await contracts()).length === 2)).toBe(true);
      await new Promise((r) => setTimeout(r, 1500));
      expect((await contracts()).map((c) => c.quoteRef)).toEqual(['COT-0008', 'COT-0009']);
      expect(await dlqCount()).toBe(0);
    });

    it('invalid events go to the dead-letter queue and create nothing; the consumer keeps living', async () => {
      const dead = await dlqCount();
      const bad = [qe(10, { type: 'Other' }), qe(11, {}, { amountCop: 0 }), qe(12, {}, { amountCop: 2_147_483_648 }), qe(13, {}, { amountCop: 1.5 }), qe(14, {}, { quoteNumber: 'x' }), qe(15, {}, { projectId: 'a b' }),
        qe(16, {}, { clientName: '' }), qe(17, {}, { clientName: '<b>x</b>' }), qe(18, {}, { approvedBy: 'no-email' }), qe(19, { eventId: 'nope' }), qe(20, {}, { quoteId: 'zz' }), qe(21, { occurredAt: 'ayer' })];
      for (const b of bad) pub(b);
      pub(Buffer.from('{no json'), true);
      expect(await waitUntil(async () => (await dlqCount()) === dead + bad.length + 1)).toBe(true);
      expect(await contracts()).toHaveLength(0);
      pub(qe(22)); expect(await waitUntil(async () => (await contracts()).length === 1)).toBe(true);
    });

    it('CONCURRENCY: 30 different approved quotes at once → 30 contracts, none lost or doubled', async () => {
      for (let i = 1; i <= 30; i++) pub(qe(100 + i));
      expect(await waitUntil(async () => (await contracts()).length === 30, 30_000)).toBe(true);
      await new Promise((r) => setTimeout(r, 1000));
      expect(await prisma.contract.count({ where: { quoteRef: { not: null } } })).toBe(30); expect(await dlqCount()).toBe(0);
    }, 60_000);
  });
});
