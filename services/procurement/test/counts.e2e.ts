import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, resetState, SEED_ITEMS, SEED_SUPPLIERS, token, USERS } from './helpers';

process.env.RATE_LIMIT = '100000';

describe('physical count: open, count, close with reconciliation (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const as = (u: any) => bearer(token(u));
  const call = (m: 'get' | 'post' | 'patch', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', as(who)); return body ? r.send(body) : r; };
  const [SENSOR, PSU, SWITCH] = SEED_ITEMS; // existencias del seed: 8, 3, 2
  const M = USERS.manager;
  const open = () => call('post', '/counts', M);
  const count = (id: string, item: string, counted: unknown) => call('patch', `/counts/${id}/lines/${item}`, M, { counted });
  const close = (id: string) => call('post', `/counts/${id}/close`, M);
  const stock = async (id: string) => (await prisma.item.findUniqueOrThrow({ where: { id } })).onHand;
  const sumMov = async (id: string) => Number((await prisma.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(delta) AS s FROM stock_movements WHERE item_id = ${id}::uuid`)[0].s ?? 0);
  const order = (itemId: string, quantity: number) => call('post', '/orders', M, { supplierId: SEED_SUPPLIERS[0], itemId, quantity, unitPriceCop: 100_000 });
  const receive = async (itemId: string, qty: number) => { const o = await order(itemId, qty); return call('post', `/orders/${o.body.id}/receive`, M); };

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  it('roles: manager, lead and billing read; sales does not; only the manager opens, counts, closes and cancels; no token is 401', async () => {
    const c = (await open()).body;
    expect((await call('get', '/counts')).status).toBe(401);
    for (const u of [USERS.lead, USERS.billing]) { expect((await call('get', '/counts', u)).status).toBe(200); expect((await call('get', `/counts/${c.id}`, u)).status).toBe(200); }
    expect((await call('get', '/counts', USERS.sales)).status).toBe(403);
    for (const u of [USERS.lead, USERS.billing, USERS.sales]) {
      expect((await call('post', '/counts', u)).status).toBe(403);
      expect((await call('patch', `/counts/${c.id}/lines/${SENSOR}`, u, { counted: 1 })).status).toBe(403);
      expect((await call('post', `/counts/${c.id}/close`, u)).status).toBe(403);
      expect((await call('post', `/counts/${c.id}/cancel`, u)).status).toBe(403);
    }
    expect(await stock(SENSOR)).toBe(8); expect((await prisma.stockCount.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('open');
  });

  it('opening takes a snapshot of every item; a second open count is refused (409) until the first is closed or cancelled', async () => {
    const r = await open(); expect(r.status).toBe(201); expect(r.body).toMatchObject({ status: 'open', lines: 3, counted: 0, differences: 0, openedBy: M.email });
    const lines = (await call('get', `/counts/${r.body.id}`, M)).body.lines;
    expect(lines.map((l: any) => [l.expected, l.counted]).sort()).toEqual([[2, null], [3, null], [8, null]]);
    expect((await open()).status).toBe(409);
    expect((await call('post', `/counts/${r.body.id}/cancel`, M)).body.status).toBe('cancelled');
    expect((await open()).status).toBe(201);
  });

  it('CONCURRENCY: 8 simultaneous opens → exactly one 201 and seven 409, one open count in the database (20 rounds)', async () => {
    for (let r = 0; r < 20; r++) {
      await resetState(prisma);
      const res = await Promise.all(Array.from({ length: 8 }, () => open()));
      expect(res.filter((x) => x.status === 201)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
      expect(await prisma.stockCount.count({ where: { status: 'open' } })).toBe(1);
    }
  }, 120_000);

  it('bad input is refused and changes nothing: negative, decimal, text, huge, null counted; unknown item (404); malformed ids (400)', async () => {
    const c = (await open()).body;
    for (const bad of [-1, 1.5, '5', 1_000_001, null, {}, [], true]) expect((await count(c.id, SENSOR, bad)).status).toBe(400);
    expect((await call('patch', `/counts/${c.id}/lines/${SENSOR}`, M, {})).status).toBe(400);
    expect((await count(c.id, randomUUID(), 3)).status).toBe(404);
    expect((await count(randomUUID(), SENSOR, 3)).status).toBe(404);
    expect((await call('patch', `/counts/x/lines/${SENSOR}`, M, { counted: 1 })).status).toBe(400);
    expect((await call('patch', `/counts/${c.id}/lines/zz`, M, { counted: 1 })).status).toBe(400);
    expect((await call('get', `/counts/${randomUUID()}`, M)).status).toBe(404);
    expect((await call('get', '/counts/zz', M)).status).toBe(400);
    expect((await prisma.stockCountLine.findMany({ where: { countId: c.id, counted: { not: null } } }))).toHaveLength(0);
  });

  it('closing applies counted − expected: movements (source count) with the actor, StockChanged events, stock updated; uncounted and equal lines are left alone', async () => {
    const c = (await open()).body;
    expect((await count(c.id, SENSOR, 6)).body).toMatchObject({ expected: 8, counted: 6, variance: -2 });
    await count(c.id, PSU, 3); // igual: sin movimiento
    // SWITCH sin contar: no se toca
    const r = await close(c.id); expect(r.status).toBe(200);
    expect(r.body.adjustments).toEqual([{ itemName: 'Sensor de temperatura TH-10', delta: -2, onHandAfter: 6 }]);
    expect(await stock(SENSOR)).toBe(6); expect(await stock(PSU)).toBe(3); expect(await stock(SWITCH)).toBe(2);
    const mv = await prisma.stockMovement.findMany({ where: { source: 'count' } });
    expect(mv).toHaveLength(1); expect(mv[0]).toMatchObject({ itemId: SENSOR, delta: -2, onHandAfter: 6, actor: M.email, reason: `Conteo físico #${c.number}` });
    const ev = (await prisma.outboxEvent.findMany({ where: { type: 'StockChanged' } })).map((e: any) => e.payload.data);
    expect(ev).toHaveLength(1); expect(ev[0]).toMatchObject({ delta: -2, onHand: 6, reason: 'adjustment', note: `Conteo físico #${c.number}` });
    const done = (await call('get', `/counts/${c.id}`, M)).body;
    expect(done.count).toMatchObject({ status: 'closed', closedBy: M.email, counted: 2, differences: 1 }); expect(done.lines.find((l: any) => l.itemId === SENSOR).appliedDelta).toBe(-2);
    for (const id of SEED_ITEMS) expect(await sumMov(id)).toBe(await stock(id)); // el historial sigue sumando
  });

  it('what moved AFTER opening is kept: the difference is against the snapshot, applied on top of the current stock', async () => {
    const c = (await open()).body; // esperado 8
    await receive(SENSOR, 5); // ahora 13
    await count(c.id, SENSOR, 6); // se contó 6 de los 8 que había: faltan 2
    expect((await close(c.id)).status).toBe(200);
    expect(await stock(SENSOR)).toBe(11);
    expect(await sumMov(SENSOR)).toBe(11);
  });

  it('a close that would leave ANY item below zero is refused as a whole (409 naming it) and nothing is applied', async () => {
    const c = (await open()).body; // SENSOR 8, PSU 3
    await count(c.id, SENSOR, 20); // +12
    await count(c.id, PSU, 0); // −3
    await call('post', `/inventory/items/${PSU}/adjust`, M, { delta: -3, reason: 'Used on site' }); // PSU ahora 0 → el conteo lo dejaría en −3
    const r = await close(c.id); expect(r.status).toBe(409); expect(r.body.message).toMatch(/Fuente de poder 12 V has 0 in stock now: the count would leave it at -3/);
    expect(await stock(SENSOR)).toBe(8); expect(await stock(PSU)).toBe(0);
    expect((await prisma.stockCount.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('open'); // sigue abierto para corregirlo
    expect(await prisma.stockMovement.count({ where: { source: 'count' } })).toBe(0);
    expect((await prisma.outboxEvent.findMany({ where: { type: 'StockChanged' } })).length).toBe(1); // solo el ajuste manual
    await count(c.id, PSU, 3); expect((await close(c.id)).status).toBe(200); // corregido: ahora sí
    expect(await stock(SENSOR)).toBe(20);
  });

  it('a closed or cancelled count accepts nothing: no more counted values, no second close, no cancel after close', async () => {
    const c = (await open()).body; await count(c.id, SENSOR, 7); expect((await close(c.id)).status).toBe(200);
    expect((await count(c.id, SENSOR, 1)).status).toBe(409); expect((await close(c.id)).status).toBe(409); expect((await call('post', `/counts/${c.id}/cancel`, M)).status).toBe(409);
    expect(await stock(SENSOR)).toBe(7);
    const d = (await open()).body; await count(d.id, SENSOR, 1); await call('post', `/counts/${d.id}/cancel`, M);
    expect((await close(d.id)).status).toBe(409); expect((await count(d.id, SENSOR, 2)).status).toBe(409); expect(await stock(SENSOR)).toBe(7);
  });

  it('CONCURRENCY: 30 rounds of 6 closes at once → exactly one applies, the stock moves ONCE and the history still adds up', async () => {
    for (let r = 0; r < 30; r++) {
      await resetState(prisma);
      const c = (await open()).body; await count(c.id, SENSOR, 5); await count(c.id, SWITCH, 9);
      const res = await Promise.all(Array.from({ length: 6 }, () => close(c.id)));
      expect(res.filter((x) => x.status === 200)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(5);
      expect(await stock(SENSOR)).toBe(5); expect(await stock(SWITCH)).toBe(9);
      expect(await prisma.stockMovement.count({ where: { source: 'count' } })).toBe(2);
      for (const id of SEED_ITEMS) expect(await sumMov(id)).toBe(await stock(id));
    }
  }, 180_000);

  it('CONCURRENCY: closing, cancelling and counting at once → exactly one of close/cancel wins, and the stock matches the winner', async () => {
    for (let r = 0; r < 30; r++) {
      await resetState(prisma);
      const c = (await open()).body; await count(c.id, SENSOR, 1);
      const res = await Promise.all([close(c.id), call('post', `/counts/${c.id}/cancel`, M), close(c.id), call('post', `/counts/${c.id}/cancel`, M), count(c.id, SENSOR, 2).then((x: any) => x)]);
      const closes = [res[0], res[2]].filter((x) => x.status === 200), cancels = [res[1], res[3]].filter((x) => x.status === 200);
      expect(closes.length + cancels.length).toBe(1);
      const final = (await prisma.stockCount.findUniqueOrThrow({ where: { id: c.id } })).status;
      const line = await prisma.stockCountLine.findUniqueOrThrow({ where: { countId_itemId: { countId: c.id, itemId: SENSOR } } });
      if (final === 'cancelled') expect(await stock(SENSOR)).toBe(8); else { expect(final).toBe('closed'); expect(await stock(SENSOR)).toBe(8 + (line.counted! - 8)); expect(line.appliedDelta).toBe(line.counted! - 8); }
      for (const id of SEED_ITEMS) expect(await sumMov(id)).toBe(await stock(id));
    }
  }, 180_000);

  it('CONCURRENCY: closing while orders are received and manual adjustments happen → no deadlock, no lost update: the history always adds up to the stock', async () => {
    for (let r = 0; r < 20; r++) {
      await resetState(prisma);
      const c = (await open()).body; await count(c.id, SENSOR, 4); await count(c.id, PSU, 5);
      const orders = await Promise.all([order(SENSOR, 3), order(PSU, 2), order(SENSOR, 1)]);
      const res = await Promise.all([close(c.id), ...orders.map((o) => call('post', `/orders/${o.body.id}/receive`, M)), call('post', `/inventory/items/${SENSOR}/adjust`, M, { delta: -1, reason: 'Used on site' }), call('post', `/inventory/items/${PSU}/adjust`, M, { delta: 1, reason: 'Return from site' })]);
      for (const x of res) expect([200, 409]).toContain(x.status);
      expect(res[0].status).toBe(200);
      for (const id of SEED_ITEMS) { expect(await stock(id)).toBeGreaterThanOrEqual(0); expect(await sumMov(id)).toBe(await stock(id)); }
    }
  }, 240_000);

  it('the database itself allows one open count only and a closed count must have a closing date', async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO stock_counts (status) VALUES ('open')`);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO stock_counts (status) VALUES ('open')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO stock_counts (status) VALUES ('closed')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO stock_counts (status, closed_at) VALUES ('open', now())`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO stock_counts (status) VALUES ('weird')`)).rejects.toThrow();
  });
});
