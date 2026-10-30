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
const created = (n: string | number, over: any = {}) => env('MilestoneCreated', { milestoneId: `t${n}`, milestoneName: `Milestone ${n}`, projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 1_000_000, ...over });
const overdue = (n: string | number, over: any = {}) => env('OverdueDetected', { ...inv(n), dueDate: '2026-10-20T15:00:00.000Z', daysOverdue: 9, ...over });
const payEv = (n: string | number, data: any = {}) => env('PaymentReceived', { invoiceNumber: 'INV-0103', milestoneId: `t${n}`, projectName: 'Branch network upgrade', milestoneName: `Milestone ${n}`, totalCop: 1_190_000, paymentCop: 500_000, paidCop: 500_000, balanceCop: 690_000, paidInFull: false, method: 'transfer', ...data });
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
    expect((await prisma.activityEntry.findMany()).map((a) => a.message)).toEqual(['laura.rios@nexus.example approved “Milestone 1” (Branch network upgrade) · 1.000.000 COP']);
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

  it('MilestoneCreated (real routing key) makes a PENDING milestone: the dashboard counts it, approving it stops counting it, and a repeated event changes nothing', async () => {
    const before = (await dashboard()).body.totals.milestonesPending;
    expect(before).toEqual({ count: 0, cop: 0 });
    const e = created(31);
    ch.publish(EXCHANGE, 'project.milestone.created', Buffer.from(JSON.stringify(e)), { persistent: true });
    ch.publish(EXCHANGE, 'project.milestone.created', Buffer.from(JSON.stringify(e)), { persistent: true }); // la misma entrega otra vez
    expect(await waitUntil(async () => (await fact('t31')) !== null)).toBe(true);
    expect(await fact('t31')).toMatchObject({ projectId: 'p1', createdAt: new Date(e.occurredAt), approvedAt: null, approvedBy: null });
    let d = (await dashboard()).body;
    expect(d.totals.milestonesPending).toEqual({ count: 1, cop: 1_000_000 });
    expect(d.projects.find((r: any) => r.projectName === 'Branch network upgrade').milestonesPending).toBe(1);
    expect(await processedCount()).toBe(1); // la repetición no se procesó dos veces
    expect((await prisma.activityEntry.findMany()).map((a) => a.message)).toEqual(['New milestone “Milestone 31” (Branch network upgrade) · 1.000.000 COP pending approval']);
    toQueue(approved(31));
    expect(await waitUntil(async () => (await fact('t31'))?.approvedAt != null)).toBe(true);
    d = (await dashboard()).body;
    expect(d.totals.milestonesPending).toEqual({ count: 0, cop: 0 });
    expect((await fact('t31'))?.createdAt).toEqual(new Date(e.occurredAt)); // sigue sabiendo cuándo nació
  });

  it('if the approval arrives BEFORE the creation event the milestone is not pending (arrival order does not matter)', async () => {
    toQueue(approved(32));
    expect(await waitUntil(async () => (await fact('t32')) !== null)).toBe(true);
    toQueue(created(32));
    expect(await waitUntil(async () => (await fact('t32'))?.createdAt != null)).toBe(true);
    expect((await dashboard()).body.totals.milestonesPending).toEqual({ count: 0, cop: 0 });
  });

  it('a MilestoneCreated with a bad amount goes to the dead-letter queue and creates nothing', async () => {
    toQueue(created(33, { amountCop: -1 }));
    expect(await waitUntil(async () => (await dlq()) === 1)).toBe(true);
    expect(await fact('t33')).toBeNull();
  });

  it('OverdueDetected (real routing key) marks the invoice overdue: the dashboard counts it with its total, the activity says the days, and a repeated delivery changes nothing', async () => {
    toQueue(approved(41)); toQueue(drafted(41, { invoiceNumber: 'INV-4101' })); toQueue(issued(41, { invoiceNumber: 'INV-4101' }));
    expect(await waitUntil(async () => (await fact('t41'))?.invoiceStatus === 'issued')).toBe(true);
    expect((await dashboard()).body.totals.overdue).toEqual({ count: 0, totalCop: 0 });
    const e = overdue(41, { invoiceNumber: 'INV-4101' });
    ch.publish(EXCHANGE, 'billing.invoice.overdue', Buffer.from(JSON.stringify(e)), { persistent: true });
    ch.publish(EXCHANGE, 'billing.invoice.overdue', Buffer.from(JSON.stringify(e)), { persistent: true });
    expect(await waitUntil(async () => (await fact('t41'))?.overdueAt != null)).toBe(true);
    expect(await fact('t41')).toMatchObject({ invoiceStatus: 'issued', overdueDays: 9, overdueAt: new Date(e.occurredAt) });
    const d = (await dashboard()).body;
    expect(d.totals.overdue).toEqual({ count: 1, totalCop: 1_190_000 });
    expect(d.projects.find((r: any) => r.projectName === 'Branch network upgrade').overdueInvoices).toBe(1);
    expect((await prisma.activityEntry.findMany({ where: { kind: 'OverdueDetected' } })).map((a) => a.message)).toEqual(['Invoice INV-4101 is overdue by 9 days · total 1.190.000 COP']);
    expect(await prisma.processedEvent.count({ where: { eventId: e.eventId } })).toBe(1);
  });

  it('an overdue notice that arrives BEFORE the invoice events is kept and merged when they arrive (order does not matter)', async () => {
    toQueue(overdue(42, { invoiceNumber: 'INV-4201' }));
    expect(await waitUntil(async () => (await fact('t42'))?.overdueAt != null)).toBe(true);
    toQueue(approved(42)); toQueue(drafted(42, { invoiceNumber: 'INV-4201' })); toQueue(issued(42, { invoiceNumber: 'INV-4201' }));
    expect(await waitUntil(async () => (await fact('t42'))?.invoiceStatus === 'issued')).toBe(true);
    expect(await fact('t42')).toMatchObject({ overdueDays: 9, approvedBy: 'laura.rios@nexus.example', invoiceNumber: 'INV-4201' });
    expect((await dashboard()).body.totals.overdue.count).toBe(1);
  });

  it('an OverdueDetected with zero days or a bad total goes to the dead-letter queue and changes nothing', async () => {
    toQueue(overdue(43, { daysOverdue: 0 }));
    expect(await waitUntil(async () => (await dlq()) === 1)).toBe(true);
    toQueue(overdue(44, { totalCop: 5 }));
    expect(await waitUntil(async () => (await dlq()) === 2)).toBe(true);
    expect(await fact('t43')).toBeNull(); expect(await fact('t44')).toBeNull();
  });

  it('PaymentReceived (real routing key) records what was paid; a repeat changes nothing; a fully paid overdue invoice leaves the overdue count', async () => {
    toQueue(approved(51)); toQueue(drafted(51, { invoiceNumber: 'INV-5101' })); toQueue(issued(51, { invoiceNumber: 'INV-5101' }));
    expect(await waitUntil(async () => (await fact('t51'))?.invoiceStatus === 'issued')).toBe(true);
    ch.publish(EXCHANGE, 'billing.invoice.overdue', Buffer.from(JSON.stringify(overdue(51, { invoiceNumber: 'INV-5101' }))), { persistent: true });
    expect(await waitUntil(async () => (await fact('t51'))?.overdueAt != null)).toBe(true);
    expect((await dashboard()).body.totals.overdue.count).toBe(1);
    const p1 = payEv(51, { invoiceNumber: 'INV-5101' });
    ch.publish(EXCHANGE, 'billing.payment.received', Buffer.from(JSON.stringify(p1)), { persistent: true });
    ch.publish(EXCHANGE, 'billing.payment.received', Buffer.from(JSON.stringify(p1)), { persistent: true });
    expect(await waitUntil(async () => (await fact('t51'))?.paidCop === 500_000)).toBe(true);
    let d = (await dashboard()).body;
    expect(d.totals.collected).toEqual({ totalCop: 500_000, paidInvoices: 0 }); expect(d.totals.overdue.count).toBe(1); // pagada a medias: sigue vencida
    toQueue(payEv(51, { invoiceNumber: 'INV-5101', paymentCop: 690_000, paidCop: 1_190_000, balanceCop: 0, paidInFull: true }));
    expect(await waitUntil(async () => (await fact('t51'))?.paidCop === 1_190_000)).toBe(true);
    d = (await dashboard()).body;
    expect(d.totals.collected).toEqual({ totalCop: 1_190_000, paidInvoices: 1 }); expect(d.totals.overdue).toEqual({ count: 0, totalCop: 0 });
    expect((await prisma.activityEntry.findMany({ where: { kind: 'PaymentReceived' }, orderBy: { occurredAt: 'asc' } })).map((a) => a.message)).toEqual([
      'Payment of 500.000 COP for invoice INV-5101 · balance 690.000 COP', 'Payment of 690.000 COP for invoice INV-5101 · paid in full']);
  });

  it('a payment that arrives BEFORE the invoice events is kept and merged (order does not matter); inconsistent payments go to the dead-letter queue', async () => {
    toQueue(payEv(52, { invoiceNumber: 'INV-5201' }));
    expect(await waitUntil(async () => (await fact('t52'))?.paidCop === 500_000)).toBe(true);
    toQueue(approved(52)); toQueue(drafted(52, { invoiceNumber: 'INV-5201' })); toQueue(issued(52, { invoiceNumber: 'INV-5201' }));
    expect(await waitUntil(async () => (await fact('t52'))?.invoiceStatus === 'issued')).toBe(true);
    expect(await fact('t52')).toMatchObject({ paidCop: 500_000, approvedBy: 'laura.rios@nexus.example' });
    toQueue(payEv(53, { paidCop: 1 })); toQueue(payEv(54, { method: 'bitcoin' }));
    expect(await waitUntil(async () => (await dlq()) === 2)).toBe(true);
    expect(await fact('t53')).toBeNull(); expect(await fact('t54')).toBeNull();
  });
});
