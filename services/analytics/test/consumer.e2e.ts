import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, connect } from 'amqplib';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'true';
process.env.RATE_LIMIT = '100000';
const EXCHANGE = 'erp.events', QUEUE = 'q.analytics', DLQ = 'q.analytics.dlq';

const inv = (n: string | number, over: any = {}) => ({ invoiceNumber: 'INV-0103', milestoneId: `t${n}`, projectName: 'Branch network upgrade', milestoneName: `Milestone ${n}`, amountCop: 1_000_000, taxCop: 190_000, totalCop: 1_190_000, ...over });
const env = (type: string, data: any, over: any = {}) => ({ eventId: randomUUID(), type, occurredAt: new Date().toISOString(), correlationId: 'trace-an-0001', data, ...over });
const approved = (n: string | number, over: any = {}) => env('MilestoneApproved', { milestoneId: `t${n}`, milestoneName: `Milestone ${n}`, projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 1_000_000, approvedBy: 'laura.rios@nexus.example', ...over });
const drafted = (n: string | number, over: any = {}) => env('InvoiceDrafted', { ...inv(n), approvedBy: 'laura.rios@nexus.example', ...over });
const issued = (n: string | number, over: any = {}) => env('InvoiceIssued', { ...inv(n), issuedBy: 'andres.mora@nexus.example', ...over });

describe('analytics consumer (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  // Directo a la cola (no por el exchange): la cola existe antes de quedar vinculada y un mensaje publicado en ese instante se perdería.
  const toQueue = (b: unknown, raw = false) => ch.sendToQueue(QUEUE, raw ? (b as Buffer) : Buffer.from(JSON.stringify(b)), { persistent: true, contentType: 'application/json' });
  const waitUntil = async (cond: () => boolean | Promise<boolean>, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };
  const fact = (m: string) => prisma.milestoneFact.findUnique({ where: { milestoneId: m } });
  const processedCount = () => prisma.processedEvent.count();
  const dlq = async () => (await ch.checkQueue(DLQ)).messageCount;
  const dashboard = () => request(app.getHttpServer()).get('/dashboard').set('Authorization', bearer(token(USERS.manager)));

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory');
    app = await createApp(); await app.init(); // arranca el consumidor
    conn = await connect(process.env.RABBITMQ_URL as string); ch = await conn.createChannel();
    // Con un RabbitMQ recién creado la cola aún no existe: se consulta en un canal desechable hasta que el consumidor la cree.
    const exists = async () => { const c = await conn.createChannel(); c.on('error', () => undefined); try { await c.checkQueue(QUEUE); await c.close(); return true; } catch { return false; } };
    expect(await waitUntil(exists)).toBe(true);
  });
  beforeEach(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); });
  afterAll(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); await ch.close(); await conn.close(); await app.close(); await prisma.$disconnect(); });

  it('turns MilestoneApproved into a fact and an activity line', async () => {
    const e = approved(1); toQueue(e);
    expect(await waitUntil(async () => (await fact('t1')) !== null)).toBe(true);
    expect(await fact('t1')).toMatchObject({ projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 1_000_000, approvedBy: 'laura.rios@nexus.example', invoiceNumber: null, invoiceStatus: null });
    expect((await prisma.activityEntry.findMany()).map((a) => a.message)).toEqual(['laura.rios@nexus.example approved “Milestone 1” (Branch network upgrade) · 1,000,000 COP']);
    expect(await processedCount()).toBe(1);
  });

  it('follows a milestone through approval, draft and issue, and the dashboard shows it', async () => {
    toQueue(approved(2));
    expect(await waitUntil(async () => (await fact('t2')) !== null)).toBe(true);
    toQueue(drafted(2, { invoiceNumber: 'INV-0201' }));
    expect(await waitUntil(async () => (await fact('t2'))?.invoiceStatus === 'draft')).toBe(true);
    let d = (await dashboard()).body;
    expect(d.totals.waitingForInvoice.count).toBe(0); expect(d.totals.draft).toEqual({ count: 1, totalCop: 1_190_000 });
    toQueue(issued(2, { invoiceNumber: 'INV-0201' }));
    expect(await waitUntil(async () => (await fact('t2'))?.invoiceStatus === 'issued')).toBe(true);
    d = (await dashboard()).body;
    expect(d.totals.issued).toEqual({ count: 3, subtotalCop: 22_800_000, taxCop: 4_332_000, totalCop: 27_132_000 }); // 2 del seed + esta
    expect(d.totals.draft.count).toBe(0);
    expect(d.recentActivity.map((a: any) => a.kind)).toEqual(['InvoiceIssued', 'InvoiceDrafted', 'MilestoneApproved']);
  });

  it('gives the same fact when the events arrive in REVERSE order', async () => {
    toQueue(issued(3, { invoiceNumber: 'INV-0301' })); toQueue(drafted(3, { invoiceNumber: 'INV-0301' })); toQueue(approved(3));
    expect(await waitUntil(async () => { const f = await fact('t3'); return !!f && f.approvedAt !== null && f.draftedAt !== null && f.issuedAt !== null; })).toBe(true);
    expect(await fact('t3')).toMatchObject({ invoiceNumber: 'INV-0301', invoiceStatus: 'issued', approvedBy: 'laura.rios@nexus.example', taxCop: 190_000, totalCop: 1_190_000 });
  });

  it('CONCURRENCY: 30 rounds of the 3 events of one milestone in random order and in parallel always end in the same fact', async () => {
    for (let round = 1; round <= 30; round++) {
      await resetState(prisma);
      const evs = [approved('c'), drafted('c', { invoiceNumber: 'INV-0401' }), issued('c', { invoiceNumber: 'INV-0401' })].sort(() => Math.random() - 0.5);
      for (const e of evs) toQueue(e);
      const done = await waitUntil(async () => (await processedCount()) === 3, 8000);
      if (!done) throw new Error(`round ${round}: only ${await processedCount()} of 3 events processed`);
      const f = await fact('tc');
      if (!f || f.invoiceStatus !== 'issued' || !f.approvedAt || !f.draftedAt || !f.issuedAt || f.totalCop !== 1_190_000) throw new Error(`round ${round}: ${JSON.stringify(f)}`);
      expect(await prisma.milestoneFact.count({ where: { milestoneId: 'tc' } })).toBe(1);
    }
  }, 240_000);

  it('ignores the same event delivered 20 times at once', async () => {
    const e = approved(5); for (let i = 0; i < 20; i++) toQueue(e);
    expect(await waitUntil(async () => (await fact('t5')) !== null)).toBe(true);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await processedCount()).toBe(1); expect(await prisma.activityEntry.count()).toBe(1); expect(await dlq()).toBe(0);
  });

  it('processes 50 different events in parallel without losing any', async () => {
    for (let i = 0; i < 50; i++) toQueue(approved(`p${i}`, { amountCop: 1000 + i }));
    expect(await waitUntil(async () => (await processedCount()) === 50, 15_000)).toBe(true);
    expect(await prisma.milestoneFact.count({ where: { milestoneId: { startsWith: 'tp' } } })).toBe(50);
  });

  it.each([
    ['not JSON', () => toQueue(Buffer.from('{nope'), true)],
    ['an unknown type', () => toQueue(env('MilestoneRejected', { milestoneId: 't9' }))],
    ['a negative amount', () => toQueue(approved(9, { amountCop: -50 }))],
    ['a total that does not add up', () => toQueue(drafted(9, { totalCop: 5 }))],
    ['an oversized message', () => toQueue(approved(9, { milestoneName: 'x'.repeat(20_000) }))],
  ])('sends %s to the dead-letter queue and keeps working', async (_n, send) => {
    send();
    expect(await waitUntil(async () => (await dlq()) === 1)).toBe(true);
    expect(await prisma.milestoneFact.count({ where: { milestoneId: { notIn: ['m1', 'm4'] } } })).toBe(0);
    toQueue(approved(8)); // el siguiente mensaje sano se procesa igual
    expect(await waitUntil(async () => (await fact('t8')) !== null)).toBe(true);
  });

  it('FRESHNESS: an event is visible in the dashboard in well under the 60 s target (and the lag is reported)', async () => {
    const e = approved(7, { amountCop: 2_000_000 }); const t0 = Date.now(); e.occurredAt = new Date(t0).toISOString(); toQueue(e);
    expect(await waitUntil(async () => (await dashboard()).body.totals.milestonesApproved === 3)).toBe(true);
    const seen = Date.now() - t0;
    const d = (await dashboard()).body;
    console.log(`freshness: dashboard saw the event ${seen} ms after it occurred · reported lag ${d.freshness.lastEventLagMs} ms`);
    expect(seen).toBeLessThan(60_000);
    expect(d.freshness.lastEventLagMs).toBeLessThan(60_000);
  });

  it('also receives events published to the exchange with the real routing keys', async () => {
    const e = approved(6);
    ch.publish(EXCHANGE, 'project.milestone.approved', Buffer.from(JSON.stringify(e)), { persistent: true });
    ch.publish(EXCHANGE, 'billing.invoice.drafted', Buffer.from(JSON.stringify(drafted(6, { invoiceNumber: 'INV-0601' }))), { persistent: true });
    ch.publish(EXCHANGE, 'billing.invoice.issued', Buffer.from(JSON.stringify(issued(6, { invoiceNumber: 'INV-0601' }))), { persistent: true });
    expect(await waitUntil(async () => (await fact('t6'))?.invoiceStatus === 'issued')).toBe(true);
  });
});
