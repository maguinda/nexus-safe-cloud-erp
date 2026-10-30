import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { DetectOverdueInvoicesUseCase } from '../src/application/detect-overdue.use-case';
import { PrismaOverdueUnitOfWork } from '../src/infrastructure/prisma-units-of-work';
import { bearer, OTHER_KEYS, resetState, token, unsigned, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false';
process.env.RELAY_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

describe('payments: rules, roles, concurrency and events (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const as = (u: any) => bearer(token(u));
  const call = (m: 'get' | 'post', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', as(who)); return body ? r.send(body) : r; };
  let seq = 600;
  /** Una factura emitida de 1.190.000 (1.000.000 + 190.000 de IVA). */
  const issued = async (status: 'issued' | 'draft' = 'issued', due = '2026-12-30T15:00:00Z') => {
    const n = seq++; const number = `INV-${String(n).padStart(4, '0')}`;
    await prisma.invoice.create({ data: { number, milestoneId: `pay${n}`, projectName: 'Branch network upgrade', milestoneName: `Milestone ${n}`, amountCop: 1_000_000, taxCop: 190_000, totalCop: 1_190_000, status,
      issuedAt: status === 'issued' ? new Date('2026-10-30T15:00:00Z') : null, issuedBy: status === 'issued' ? 'andres.mora@nexus.example' : null, dueDate: status === 'issued' ? new Date(due) : null, clientName: 'Banco Andino (example)' } });
    return number;
  };
  const pay = (n: string, amountCop: number, who: any = USERS.billing, extra: object = {}) => call('post', `/invoices/${n}/payments`, who, { amountCop, method: 'transfer', ...extra });
  const paid = async (n: string) => Number((await prisma.$queryRaw<{ s: bigint }[]>`SELECT COALESCE(SUM(amount_cop),0) AS s FROM payments WHERE invoice_number = ${n}`)[0].s);
  const events = () => prisma.outboxEvent.findMany({ where: { type: 'PaymentReceived' }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('bad tokens are rejected with 401', () => {
    const bad: [string, string | undefined][] = [
      ['no token', undefined], ['garbage', 'Bearer not.a.jwt'], ['expired', bearer(token(USERS.billing, { expiresIn: -60 }))], ['wrong audience', bearer(token(USERS.billing, { audience: 'x' }))],
      ['wrong issuer', bearer(token(USERS.billing, { issuer: 'evil' }))], ['another key', bearer(token(USERS.billing, { key: OTHER_KEYS.privateKey }))], ['alg none', bearer(unsigned(USERS.billing))],
    ];
    it.each(bad)('%s', async (_n, auth) => {
      for (const m of ['get', 'post'] as const) { let r = (request(app.getHttpServer()) as any)[m]('/invoices/INV-0101/payments'); if (auth) r = r.set('Authorization', auth); expect((await r).status).toBe(401); }
    });
  });

  it('roles: only the billing analyst registers; the project lead can read; sales and the manager are refused', async () => {
    const n = await issued();
    for (const who of [USERS.lead, USERS.sales, USERS.manager]) expect((await pay(n, 1000, who)).status).toBe(403);
    expect((await call('get', `/invoices/${n}/payments`, USERS.sales)).status).toBe(403);
    expect((await call('get', `/invoices/${n}/payments`, USERS.manager)).status).toBe(403);
    expect((await pay(n, 1000)).status).toBe(201);
    for (const who of [USERS.lead, USERS.billing]) expect((await call('get', `/invoices/${n}/payments`, who)).status).toBe(200);
  });

  it('a payment returns the new balance and the status; the list shows it without who registered it', async () => {
    const n = await issued();
    const r = await pay(n, 190_000, USERS.billing, { reference: ' Bank   transfer 8841 ' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ invoiceNumber: n, amountCop: 190_000, method: 'transfer', reference: 'Bank transfer 8841', paidCop: 190_000, balanceCop: 1_000_000, paymentStatus: 'partial' });
    const list = (await call('get', `/invoices/${n}/payments`, USERS.lead)).body;
    expect(list).toHaveLength(1); expect(Object.keys(list[0]).sort()).toEqual(['amountCop', 'id', 'invoiceNumber', 'method', 'paidAt', 'reference']);
    const inv = (await call('get', '/invoices', USERS.billing)).body.find((i: any) => i.number === n);
    expect(inv).toMatchObject({ paidCop: 190_000, balanceCop: 1_000_000, paymentStatus: 'partial' });
  });

  it('the balance can be paid in parts, exactly to zero; one more peso is refused with the balance', async () => {
    const n = await issued();
    expect((await pay(n, 500_000)).body.paymentStatus).toBe('partial');
    expect((await pay(n, 690_000)).body).toMatchObject({ paidCop: 1_190_000, balanceCop: 0, paymentStatus: 'paid' });
    const over = await pay(n, 1);
    expect(over.status).toBe(409); expect(over.body.message).toContain('balance');
    expect(await paid(n)).toBe(1_190_000);
  });

  it('refuses what is not allowed: a draft, an unknown invoice, a bad amount, method or reference', async () => {
    const d = await issued('draft');
    expect((await pay(d, 1000)).status).toBe(409);
    expect((await pay('INV-9999', 1000)).status).toBe(404);
    const n = await issued();
    for (const b of [{ amountCop: 0, method: 'cash' }, { amountCop: -5, method: 'cash' }, { amountCop: 1.5, method: 'cash' }, { amountCop: '100', method: 'cash' }, { amountCop: 100, method: 'wire' }, { amountCop: 100 }, { amountCop: 100, method: 'cash', extra: 1 },
      { amountCop: 100, method: 'cash', reference: '<b>x</b>' }, { amountCop: 100, method: 'cash', reference: 'x'.repeat(101) }, {}])
      expect((await call('post', `/invoices/${n}/payments`, USERS.billing, b)).status).toBe(400);
    expect((await call('post', '/invoices/not-a-number/payments', USERS.billing, { amountCop: 100, method: 'cash' })).status).toBe(400);
    expect(await paid(n)).toBe(0); expect(await paid(d)).toBe(0);
  });

  it('every payment publishes PaymentReceived in the SAME transaction, with its own aggregate (many per invoice), no personal data', async () => {
    const n = await issued();
    await pay(n, 100_000, USERS.billing, { reference: 'one' }); await pay(n, 1_090_000);
    const ev = await events();
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ routingKey: 'billing.payment.received', publishedAt: null });
    const p0: any = ev[0].payload, p1: any = ev[1].payload;
    expect(p0.data).toMatchObject({ invoiceNumber: n, totalCop: 1_190_000, paymentCop: 100_000, paidCop: 100_000, balanceCop: 1_090_000, paidInFull: false, method: 'transfer', clientName: 'Banco Andino (example)', registeredBy: USERS.billing.email });
    expect(p1.data).toMatchObject({ paidCop: 1_190_000, balanceCop: 0, paidInFull: true });
    expect(ev[0].aggregateId).toBe(p0.data.paymentId); expect(ev[0].aggregateId).not.toBe(ev[1].aggregateId);
    // La única persona en el evento es quien registró el pago (como approvedBy / issuedBy en los otros eventos): sin ella no hay ningún correo, y la referencia tecleada no viaja.
    expect(JSON.stringify({ ...p0, data: { ...p0.data, registeredBy: undefined } })).not.toMatch(/@/);
    expect(JSON.stringify(p0)).not.toContain('Bank');
  });

  it('a rejected payment leaves nothing: no payment and no event', async () => {
    const n = await issued();
    await pay(n, 1_190_000);
    await pay(n, 5);
    expect(await prisma.payment.count({ where: { invoiceNumber: n } })).toBe(1); expect(await events()).toHaveLength(1);
  });

  it('CONCURRENCY: 30 rounds of 8 simultaneous payments of 400.000 on a 1.190.000 invoice → exactly 2 win, the paid total never passes the invoice', async () => {
    for (let round = 0; round < 30; round++) {
      await resetState(prisma);
      const n = await issued();
      const res = await Promise.all(Array.from({ length: 8 }, () => pay(n, 400_000)));
      const codes = res.map((r) => r.status);
      expect(codes.filter((c) => c === 201)).toHaveLength(2); expect(codes.filter((c) => c === 409)).toHaveLength(6); expect(codes.filter((c) => c !== 201 && c !== 409)).toEqual([]);
      expect(await paid(n)).toBe(800_000); expect(await events()).toHaveLength(2);
    }
  }, 180_000);

  it('CONCURRENCY: 20 rounds of 10 simultaneous payments that add up exactly to the total → all win and the balance is exactly 0', async () => {
    for (let round = 0; round < 20; round++) {
      await resetState(prisma);
      const n = await issued();
      const res = await Promise.all(Array.from({ length: 10 }, () => pay(n, 119_000)));
      expect(res.map((r) => r.status)).toEqual(Array(10).fill(201));
      expect(await paid(n)).toBe(1_190_000);
      expect((await pay(n, 1)).status).toBe(409);
    }
  }, 180_000);

  it('payments of different invoices never block each other', async () => {
    const [a, b] = [await issued(), await issued()];
    expect((await Promise.all([pay(a, 1_190_000), pay(b, 1_190_000)])).map((r) => r.status)).toEqual([201, 201]);
  });

  it('the database protects the payments: no UPDATE, no DELETE, no TRUNCATE, no amount over zero violation', async () => {
    const n = await issued(); await pay(n, 1000);
    await expect(prisma.$executeRaw`UPDATE payments SET amount_cop = 1 WHERE invoice_number = ${n}`).rejects.toBeTruthy();
    await expect(prisma.$executeRaw`DELETE FROM payments WHERE invoice_number = ${n}`).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe('TRUNCATE payments')).rejects.toBeTruthy();
    await expect(prisma.$executeRaw`INSERT INTO payments (invoice_number, amount_cop, method, registered_by) VALUES (${n}, 0, 'cash', 'x')`).rejects.toBeTruthy();
    await expect(prisma.$executeRaw`INSERT INTO payments (invoice_number, amount_cop, method, registered_by) VALUES (${n}, 5, 'bitcoin', 'x')`).rejects.toBeTruthy();
    expect(await paid(n)).toBe(1000);
  });

  it('a fully paid invoice does not become overdue; a partially paid one does (and its single overdue event is kept)', async () => {
    const full = await issued('issued', '2026-11-01T15:00:00Z'); const partial = await issued('issued', '2026-11-01T15:00:00Z'); const none = await issued('issued', '2026-11-01T15:00:00Z');
    await pay(full, 1_190_000); await pay(partial, 1000);
    const detector = new DetectOverdueInvoicesUseCase(new PrismaOverdueUnitOfWork(prisma), () => new Date('2026-11-20T12:00:00Z'));
    await detector.execute();
    const over = (await prisma.outboxEvent.findMany({ where: { type: 'OverdueDetected', aggregateId: { in: [full, partial, none] } } })).map((e) => e.aggregateId).sort();
    expect(over).toEqual([partial, none].sort());
  });

  it('payments of an unknown invoice are 404 on read as well; a random uuid path is just not an invoice number', async () => {
    expect((await call('get', '/invoices/INV-9999/payments', USERS.billing)).status).toBe(404);
    expect((await call('get', `/invoices/${randomUUID()}/payments`, USERS.billing)).status).toBe(400);
  });
});
