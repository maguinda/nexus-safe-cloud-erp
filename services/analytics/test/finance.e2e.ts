import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, connect } from 'amqplib';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'true';
process.env.RATE_LIMIT = '100000';
const EXCHANGE = 'erp.events', QUEUE = 'q.analytics.cash', DLQ = 'q.analytics.cash.dlq';

const env = (type: string, data: object, occurredAt = new Date().toISOString()) => ({ eventId: randomUUID(), type, occurredAt, correlationId: 'corr-12345678', data });
const KEYS: Record<string, string> = { PaymentReceived: 'billing.payment.received', PayrollPaid: 'capacity.payroll.paid', SupplierPaid: 'procurement.supplier.paid', QuoteApproved: 'project.quote.approved' };

describe('cash flow and real cost against the quote (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication; let conn: Awaited<ReturnType<typeof connect>>; let ch: Channel;
  const prisma = new PrismaClient();
  const M = USERS.manager, F = USERS.finance;
  const call = (p: string, who?: any) => { let r = request(app.getHttpServer()).get(p); if (who) r = r.set('Authorization', bearer(token(who))); return r; };
  const pub = (e: { type: string }, raw?: Buffer) => ch.publish(EXCHANGE, KEYS[e.type] ?? 'x.unknown', raw ?? Buffer.from(JSON.stringify(e)), { persistent: true, contentType: 'application/json' });
  const until = async (cond: () => Promise<boolean>, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const dlq = async () => (await ch.checkQueue(DLQ)).messageCount;
  const entries = () => prisma.cashEntry.count();
  const ym = (back: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back); return d; };
  const at = (back: number) => { const d = ym(back); d.setUTCDate(10); return d.toISOString(); };
  const payment = (cop: number, back = 0, project = 'Branch network upgrade') => env('PaymentReceived', { invoiceNumber: 'INV-0101', projectName: project, paymentCop: cop, paidAt: at(back) });

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init();
    conn = await connect(process.env.RABBITMQ_URL as string); ch = await conn.createChannel();
    const exists = async () => { const c = await conn.createChannel(); c.on('error', () => { /* 404 esperado */ }); try { await c.checkQueue(QUEUE); await c.close(); return true; } catch { return false; } };
    expect(await until(exists)).toBe(true);
  });
  beforeEach(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); });
  afterAll(async () => { await ch.purgeQueue(QUEUE); await ch.purgeQueue(DLQ); await resetState(prisma); await ch.close(); await conn.close(); await app.close(); await prisma.$disconnect(); });

  it('only the manager and finance see the money (401 without token, 403 for the other roles; bad months are 400)', async () => {
    for (const p of ['/cashflow', '/project-costs']) {
      for (const u of [M, F]) expect((await call(p, u)).status).toBe(200);
      for (const u of [USERS.lead, USERS.billing, USERS.sales]) expect((await call(p, u)).status).toBe(403);
      expect((await call(p)).status).toBe(401);
    }
    for (const bad of ['0', '37', 'x', '1.5', '-1', '100', '']) expect((await call(`/cashflow?months=${bad}`, M)).status).toBe(400);
    expect((await call('/cashflow?months=36', M)).status).toBe(200);
  });

  it('the bus feeds the cash flow: payments come in, payroll and suppliers go out, per month, with the running balance (including the months before the window)', async () => {
    const e = [payment(10_000_000, 3), payment(2_000_000, 1), env('PayrollPaid', { totalCop: 4_000_000, period: '2026-09' }, at(1)), env('SupplierPaid', { amountCop: 1_500_000, payableNumber: 'CP-0001', projectName: 'Branch network upgrade' }, at(0)), env('PayrollPaid', { totalCop: 1_000_000, period: '2026-10' }, at(0))];
    for (const x of e) pub(x);
    expect(await until(async () => (await entries()) === 5)).toBe(true);
    const r = (await call('/cashflow?months=3', M)).body;
    expect(r.months.map((m: any) => m.month)).toEqual([2, 1, 0].map((b) => ym(b).toISOString().slice(0, 7)));
    expect(r.months[0]).toMatchObject({ inCop: 0, outCop: 0, balanceCop: 10_000_000 }); // el mes de hace 3 queda fuera de la ventana pero cuenta en el saldo inicial
    expect(r.months[1]).toMatchObject({ inCop: 2_000_000, payrollCop: 4_000_000, supplierCop: 0, outCop: 4_000_000, netCop: -2_000_000, balanceCop: 8_000_000 });
    expect(r.months[2]).toMatchObject({ inCop: 0, payrollCop: 1_000_000, supplierCop: 1_500_000, outCop: 2_500_000, netCop: -2_500_000, balanceCop: 5_500_000 });
    expect(r.totals).toEqual({ inCop: 2_000_000, outCop: 6_500_000, netCop: -4_500_000 }); expect(r.balanceCop).toBe(5_500_000);
    expect((await call('/cashflow?months=1', F)).body.months).toHaveLength(1);
  });

  it('is idempotent: the same event 6 times is one entry; invalid events go to the dead-letter queue and the consumer keeps living', async () => {
    const same = payment(700_000); for (let i = 0; i < 6; i++) pub(same);
    const dead = await dlq();
    const bad = [env('PaymentReceived', { invoiceNumber: 'INV-1', paymentCop: 0, paidAt: at(0) }), env('PayrollPaid', { totalCop: 5, period: 'x' }), env('SupplierPaid', { amountCop: 1.5, payableNumber: 'CP-1' }), { ...env('PayrollPaid', { totalCop: 5, period: '2026-10' }), eventId: 'nope' }];
    for (const b of bad) pub(b); pub({ type: 'PayrollPaid' }, Buffer.from('{no json'));
    expect(await until(async () => (await dlq()) === dead + bad.length + 1)).toBe(true);
    pub(payment(300_000)); expect(await until(async () => (await entries()) === 2)).toBe(true);
    expect(await dlq()).toBe(dead + bad.length + 1);
  });

  it('CONCURRENCY: 60 events at once → 60 entries, none lost or doubled', async () => {
    for (let i = 0; i < 60; i++) pub(i % 3 === 0 ? payment(1000 + i) : i % 3 === 1 ? env('PayrollPaid', { totalCop: 2000 + i, period: '2026-10' }) : env('SupplierPaid', { amountCop: 3000 + i, payableNumber: `CP-${1000 + i}` }));
    expect(await until(async () => (await entries()) === 60, 30_000)).toBe(true); await new Promise((r) => setTimeout(r, 800));
    expect(await entries()).toBe(60); expect(await dlq()).toBe(0);
    const r = (await call('/cashflow?months=1', M)).body.months[0]; expect(r.inCop + r.outCop).toBe(Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 1000 + i : i % 3 === 1 ? 2000 + i : 3000 + i)).reduce((s, v) => s + v, 0));
  }, 60_000);

  it('real cost against the quote: the quote says what it would cost; the real one is labor to date plus suppliers paid for that project; others do not count', async () => {
    pub(env('QuoteApproved', { quoteNumber: 'COT-0009', projectId: 'p-test0001', projectName: 'Proyecto Cotizado', amountCop: 10_000_000, costCop: 8_000_000, marginPct: 25, approvedBy: 'diana.vega@nexus.example' }));
    pub(env('SupplierPaid', { amountCop: 3_000_000, payableNumber: 'CP-0100', projectName: 'Proyecto Cotizado' })); pub(env('SupplierPaid', { amountCop: 1_000_000, payableNumber: 'CP-0101', projectName: 'Proyecto Cotizado' }));
    pub(env('SupplierPaid', { amountCop: 9_000_000, payableNumber: 'CP-0102', projectName: 'Otro proyecto' })); pub(env('SupplierPaid', { amountCop: 500_000, payableNumber: 'CP-0103', projectName: null }));
    expect(await until(async () => (await entries()) === 4 && (await prisma.quoteFact.count()) === 1)).toBe(true);
    const row = (await call('/project-costs', F)).body.projects.find((p: any) => p.quoteNumber === 'COT-0009');
    expect(row).toMatchObject({ projectName: 'Proyecto Cotizado', quotedPriceCop: 10_000_000, quotedCostCop: 8_000_000, quotedMarginPct: 25, laborCostCop: 0, purchasesPaidCop: 4_000_000, realCostCop: 4_000_000, varianceCop: -4_000_000, usedPct: 50 });
    pub(env('QuoteApproved', { quoteNumber: 'COT-0009', projectId: 'p-test0001', projectName: 'Proyecto Cotizado', amountCop: 99, costCop: 1, marginPct: 0, approvedBy: 'otra@nexus.example' })); // otra copia con otro eventId: la cotización no cambia
    await new Promise((r) => setTimeout(r, 1200)); expect(await prisma.quoteFact.count()).toBe(1); expect((await prisma.quoteFact.findFirstOrThrow()).priceCop).toBe(10_000_000);
  });

  it('the database keeps the entries: no change, no delete, no category in the wrong direction, no zero amount', async () => {
    pub(payment(900_000)); expect(await until(async () => (await entries()) === 1)).toBe(true);
    for (const sql of [`UPDATE cash_entries SET amount_cop = 1`, `DELETE FROM cash_entries`, `INSERT INTO cash_entries (event_id, entry_date, direction, category, amount_cop, ref) VALUES ('${randomUUID()}', '2026-11-01', 'in', 'payroll', 5, 'x')`,
      `INSERT INTO cash_entries (event_id, entry_date, direction, category, amount_cop, ref) VALUES ('${randomUUID()}', '2026-11-01', 'out', 'customer', 5, 'x')`, `INSERT INTO cash_entries (event_id, entry_date, direction, category, amount_cop, ref) VALUES ('${randomUUID()}', '2026-11-01', 'in', 'customer', 0, 'x')`]) await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
  });
});
