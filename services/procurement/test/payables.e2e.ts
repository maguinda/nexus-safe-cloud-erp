import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, resetState, SEED_ITEMS, SEED_SUPPLIERS, token, USERS } from './helpers';

process.env.RATE_LIMIT = '100000';

describe('payables: what is owed to the suppliers (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const M = USERS.manager, F = USERS.finance;
  const call = (m: 'get' | 'post', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', bearer(token(who))); return body ? r.send(body) : r; };
  const [SENSOR] = SEED_ITEMS; const [REDES] = SEED_SUPPLIERS;
  const newOrder = async (extra: object = {}) => (await call('post', '/orders', M, { supplierId: REDES, itemId: SENSOR, quantity: 3, ...extra })).body;
  const received = async (extra: object = {}) => { const o = await newOrder(extra); expect((await call('post', `/orders/${o.id}/receive`, M)).status).toBe(200); return o; };
  const list = async (who: any = M) => (await call('get', '/payables', who)).body;
  const dayPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  it('only the manager and finance read and pay (401 without token, 403 for the other roles)', async () => {
    const o = await received();
    const id = (await list()).payables[0].id;
    for (const u of [M, F]) expect((await call('get', '/payables', u)).status).toBe(200);
    for (const u of [USERS.lead, USERS.billing, USERS.sales]) { expect((await call('get', '/payables', u)).status).toBe(403); expect((await call('post', `/payables/${id}/pay`, u, { method: 'cash' })).status).toBe(403); }
    expect((await call('get', '/payables')).status).toBe(401); expect((await call('post', `/payables/${id}/pay`, undefined, { method: 'cash' })).status).toBe(401);
    expect((await list()).payables[0].status).toBe('open'); expect(o.id).toBeTruthy();
  });

  it('receiving an order creates ONE payable with the order total, the supplier, the project and a due date 30 days later; a cancelled or pending order owes nothing', async () => {
    const pending = await newOrder(); const cancelled = await newOrder(); await call('post', `/orders/${cancelled.id}/cancel`, M);
    expect((await list()).payables).toHaveLength(0);
    const o = await received({ projectName: '  Red   sede norte ' });
    const l = await list(); expect(l.payables).toHaveLength(1);
    expect(l.payables[0]).toMatchObject({ number: expect.stringMatching(/^CP-\d{4}$/), orderId: o.id, amountCop: o.totalCop, projectName: 'Red sede norte', status: 'open', overdue: false, dueDate: dayPlus(30), paidAt: null });
    expect(l.payables[0].supplierName).toBeTruthy(); expect(l).toMatchObject({ openCop: o.totalCop, overdueCop: 0 });
    expect(pending.id).toBeTruthy();
  });

  it('an order may be tied to a project (2 to 80 characters, no markup); anything else is 400 and nothing is stored', async () => {
    for (const bad of ['x', '<b>p</b>', 'x'.repeat(81), 5, {}]) expect((await call('post', '/orders', M, { supplierId: REDES, itemId: SENSOR, quantity: 1, projectName: bad })).status).toBe(400);
    expect(await prisma.purchaseOrder.count()).toBe(0);
    const o = await newOrder({ projectName: 'Proyecto Norte' }); expect((await call('get', '/orders', M)).body.find((x: any) => x.id === o.id).projectName).toBe('Proyecto Norte');
    const none = await newOrder(); expect((await call('get', '/orders', M)).body.find((x: any) => x.id === none.id).projectName).toBeNull();
  });

  it('paying takes a valid method and an optional reference, marks it paid ONCE, tells the bus (SupplierPaid); a second payment is 409; unknown 404, bad id 400', async () => {
    await received({ projectName: 'Proyecto Norte' }); const p = (await list()).payables[0];
    for (const bad of [{}, { method: 'bitcoin' }, { method: 5 }, { method: 'cash', reference: 'ab' }, { method: 'cash', reference: '<i>x</i>' }, { method: 'cash', reference: 'x'.repeat(61) }]) expect((await call('post', `/payables/${p.id}/pay`, F, bad)).status).toBe(400);
    expect((await list()).payables[0].status).toBe('open');
    const r = await call('post', `/payables/${p.id}/pay`, F, { method: 'transfer', reference: '  TRF  8841 ' }); expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'paid', paidBy: F.email, method: 'transfer', reference: 'TRF 8841', overdue: false });
    expect((await call('post', `/payables/${p.id}/pay`, M, { method: 'cash' })).status).toBe(409);
    const ev = await prisma.outboxEvent.findMany({ where: { type: 'SupplierPaid' } }); expect(ev).toHaveLength(1);
    expect(ev[0].routingKey).toBe('procurement.supplier.paid'); expect((ev[0].payload as any).data).toEqual({ payableNumber: p.number, supplierName: p.supplierName, amountCop: p.amountCop, projectName: 'Proyecto Norte', method: 'transfer', paidBy: F.email });
    expect((await call('post', `/payables/${randomUUID()}/pay`, M, { method: 'cash' })).status).toBe(404); expect((await call('post', '/payables/zz/pay', M, { method: 'cash' })).status).toBe(400);
    expect(await list()).toMatchObject({ openCop: 0, overdueCop: 0 });
  });

  it('a payable past its due date is flagged overdue and counted in what is overdue', async () => {
    const o = await newOrder();
    await prisma.$executeRawUnsafe(`INSERT INTO payables (order_id, supplier_name, amount_cop, due_date) VALUES ('${o.id}', 'Redes del Norte', 500000, '${dayPlus(-3)}')`);
    const l = await list(); expect(l.payables[0]).toMatchObject({ overdue: true, amountCop: 500000 }); expect(l).toMatchObject({ openCop: 500000, overdueCop: 500000 });
  });

  it('the database keeps the debt: no delete, no change of amount, supplier, due date or order, no un-pay, a paid one needs who, when and how, one payable per order', async () => {
    await received(); const p = (await list()).payables[0];
    for (const sql of [`DELETE FROM payables WHERE id = '${p.id}'`, `UPDATE payables SET amount_cop = 1 WHERE id = '${p.id}'`, `UPDATE payables SET supplier_name = 'Otro' WHERE id = '${p.id}'`, `UPDATE payables SET due_date = due_date + 1 WHERE id = '${p.id}'`,
      `UPDATE payables SET status = 'paid' WHERE id = '${p.id}'`, `UPDATE payables SET status = 'paid', paid_at = now(), paid_by = 'x@y.co', method = 'bitcoin' WHERE id = '${p.id}'`]) await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
    await call('post', `/payables/${p.id}/pay`, M, { method: 'cash' });
    for (const sql of [`UPDATE payables SET status = 'open', paid_at = NULL, paid_by = NULL, method = NULL WHERE id = '${p.id}'`, `UPDATE payables SET paid_by = 'otra@x.co' WHERE id = '${p.id}'`]) await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO payables (order_id, supplier_name, amount_cop, due_date) VALUES ('${p.orderId}', 'x', 1, '2026-12-01')`)).rejects.toThrow();
  });

  it('CONCURRENCY: 8 simultaneous receptions of the same order → one payable, the stock rises once', async () => {
    for (let r = 0; r < 15; r++) {
      await resetState(prisma); const o = await newOrder();
      const res = await Promise.all(Array.from({ length: 8 }, () => call('post', `/orders/${o.id}/receive`, M)));
      expect(res.filter((x) => x.status === 200)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
      expect(await prisma.payable.count({ where: { orderId: o.id } })).toBe(1);
    }
  }, 120_000);

  it('CONCURRENCY: 8 simultaneous payments of the same payable → paid once, one SupplierPaid', async () => {
    for (let r = 0; r < 15; r++) {
      await resetState(prisma); await received(); const p = (await list()).payables[0];
      const res = await Promise.all(Array.from({ length: 8 }, (_, k) => call('post', `/payables/${p.id}/pay`, k % 2 ? M : F, { method: 'check' })));
      expect(res.filter((x) => x.status === 200)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
      expect(await prisma.outboxEvent.count({ where: { type: 'SupplierPaid' } })).toBe(1);
    }
  }, 120_000);
});
