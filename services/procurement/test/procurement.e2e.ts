import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, OTHER_KEYS, resetState, SEED_ITEMS, SEED_SUPPLIERS, token, unsigned, USERS } from './helpers';

process.env.RELAY_ENABLED = 'false'; // el relé y el consumidor se prueban en otro archivo
process.env.CONSUMER_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

describe('procurement: roles, orders, stock rules and events (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const as = (u: any) => bearer(token(u));
  const call = (m: 'get' | 'post', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', as(who)); return body ? r.send(body) : r; };
  const [SENSOR, PSU, SWITCH] = SEED_ITEMS;
  const order = (itemId = SENSOR, quantity = 5, unitPriceCop = 100_000, who = USERS.manager) => call('post', '/orders', who, { supplierId: SEED_SUPPLIERS[0], itemId, quantity, unitPriceCop });
  const stock = async (id: string) => (await prisma.item.findUniqueOrThrow({ where: { id } })).onHand;
  const outbox = () => prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('bad tokens are rejected with 401', () => {
    const bad: [string, string | undefined][] = [
      ['no token', undefined], ['garbage', 'Bearer not.a.jwt'], ['expired', bearer(token(USERS.manager, { expiresIn: -60 }))], ['wrong audience', bearer(token(USERS.manager, { audience: 'x' }))],
      ['wrong issuer', bearer(token(USERS.manager, { issuer: 'evil' }))], ['another key', bearer(token(USERS.manager, { key: OTHER_KEYS.privateKey }))], ['alg none', bearer(unsigned(USERS.manager))],
    ];
    it.each(bad)('%s', async (_n, auth) => {
      for (const [m, p] of [['get', '/inventory'], ['get', '/orders'], ['post', '/orders'], ['post', `/orders/${randomUUID()}/receive`]] as const) {
        let r = (request(app.getHttpServer()) as any)[m](p); if (auth) r = r.set('Authorization', auth); expect((await r).status).toBe(401);
      }
    });
  });

  it('roles: manager, lead and billing read; sales does not; only the manager writes', async () => {
    for (const who of [USERS.manager, USERS.lead, USERS.billing]) for (const p of ['/suppliers', '/inventory', '/orders', '/inventory/suggestions']) expect((await call('get', p, who)).status).toBe(200);
    for (const p of ['/suppliers', '/inventory', '/orders']) expect((await call('get', p, USERS.sales)).status).toBe(403);
    for (const who of [USERS.lead, USERS.billing, USERS.sales]) {
      expect((await call('post', '/suppliers', who, { name: 'Nuevo proveedor', kind: 'fixed' })).status).toBe(403);
      expect((await call('post', '/inventory/items', who, { name: 'Nuevo artículo', kind: 'spare' })).status).toBe(403);
      expect((await order(SENSOR, 1, 1000, who)).status).toBe(403);
      expect((await call('post', `/orders/${randomUUID()}/receive`, who)).status).toBe(403);
      expect((await call('post', `/inventory/items/${SENSOR}/adjust`, who, { delta: 1, reason: 'No debería' })).status).toBe(403);
    }
  });

  it('the seed gives 2 suppliers and 3 items with stock', async () => {
    expect((await call('get', '/suppliers', USERS.manager)).body).toHaveLength(2);
    const inv = (await call('get', '/inventory', USERS.manager)).body;
    expect(inv.map((i: any) => [i.name, i.onHand]).sort()).toEqual([['Fuente de poder 12 V', 3], ['Sensor de temperatura TH-10', 8], ['Switch de acceso 24 puertos', 2]]);
  });

  it('creates suppliers and items; the same name (any case) is a 409; strange input is a 400', async () => {
    expect((await call('post', '/suppliers', USERS.manager, { name: 'Proveedor Nuevo', kind: 'tender', terms: 'Por licitación' })).status).toBe(201);
    expect((await call('post', '/suppliers', USERS.manager, { name: 'proveedor nuevo', kind: 'fixed' })).status).toBe(409);
    expect((await call('post', '/inventory/items', USERS.manager, { name: 'Cable UTP', kind: 'spare', forKinds: ['temp'] })).status).toBe(201);
    expect((await call('post', '/inventory/items', USERS.manager, { name: 'CABLE utp', kind: 'spare' })).status).toBe(409);
    for (const b of [{}, { name: 'A', kind: 'fixed' }, { name: 'Valid', kind: 'x' }, { name: 'Valid', kind: 'fixed', extra: 1 }, { name: '<b>x</b>', kind: 'fixed' }]) expect((await call('post', '/suppliers', USERS.manager, b)).status).toBe(400);
  });

  it('an order is pending: it numbers PO-0001…, does not move the stock and publishes nothing', async () => {
    const r = await order(SENSOR, 5, 100_000);
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ number: expect.stringMatching(/^PO-\d{4,}$/), totalCop: 500_000, status: 'ordered' });
    expect(await stock(SENSOR)).toBe(8); expect(await outbox()).toHaveLength(0);
    const list = (await call('get', '/orders', USERS.billing)).body;
    expect(list[0]).toMatchObject({ supplierName: 'Redes del Norte (example)', itemName: 'Sensor de temperatura TH-10', quantity: 5, totalCop: 500_000, status: 'ordered', receivedAt: null });
  });

  it('bad orders: 400 for quantity, price and ids; 404 for an unknown supplier or item', async () => {
    for (const [q, p] of [[0, 1000], [100_001, 1000], [2.5, 1000], [3, 0], [100_000, 100_000]] as const) expect((await order(SENSOR, q, p)).status).toBe(400);
    expect((await call('post', '/orders', USERS.manager, { supplierId: 'x', itemId: SENSOR, quantity: 1, unitPriceCop: 1000 })).status).toBe(400);
    expect((await call('post', '/orders', USERS.manager, { supplierId: randomUUID(), itemId: SENSOR, quantity: 1, unitPriceCop: 1000 })).status).toBe(404);
    expect((await call('post', '/orders', USERS.manager, { supplierId: SEED_SUPPLIERS[0], itemId: randomUUID(), quantity: 1, unitPriceCop: 1000 })).status).toBe(404);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it('receiving a spare part raises the stock once and publishes only StockChanged; receiving equipment also publishes EquipmentPurchased', async () => {
    const a = (await order(SENSOR, 5)).body.id;
    const r = await call('post', `/orders/${a}/receive`, USERS.manager);
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ status: 'received', onHand: 13 });
    expect(await stock(SENSOR)).toBe(13);
    expect((await outbox()).map((e) => e.type)).toEqual(['StockChanged']);
    const b = (await order(SWITCH, 2, 3_000_000)).body.id;
    await call('post', `/orders/${b}/receive`, USERS.manager);
    const ev = await outbox();
    expect(ev.map((e) => [e.type, e.routingKey]).sort()).toEqual([['EquipmentPurchased', 'procurement.equipment.purchased'], ['StockChanged', 'procurement.stock.changed'], ['StockChanged', 'procurement.stock.changed']]);
    const bought: any = ev.find((e) => e.type === 'EquipmentPurchased')!.payload;
    expect(bought.data).toMatchObject({ itemName: 'Switch de acceso 24 puertos', supplierName: 'Redes del Norte (example)', quantity: 2, unitPriceCop: 3_000_000, totalCop: 6_000_000 });
    expect(Object.keys(bought.data).sort()).toEqual(['itemName', 'orderId', 'orderNumber', 'quantity', 'supplierName', 'totalCop', 'unitPriceCop']);
  });

  it('receiving twice or a cancelled order is a 409 and moves nothing; cancelling a received one too', async () => {
    const a = (await order(PSU, 4)).body.id;
    expect((await call('post', `/orders/${a}/receive`, USERS.manager)).status).toBe(200);
    expect((await call('post', `/orders/${a}/receive`, USERS.manager)).status).toBe(409);
    expect((await call('post', `/orders/${a}/cancel`, USERS.manager)).status).toBe(409);
    expect(await stock(PSU)).toBe(7);
    const b = (await order(PSU, 9)).body.id;
    expect((await call('post', `/orders/${b}/cancel`, USERS.manager)).status).toBe(200);
    expect((await call('post', `/orders/${b}/receive`, USERS.manager)).status).toBe(409);
    expect(await stock(PSU)).toBe(7);
    expect((await call('post', `/orders/${randomUUID()}/receive`, USERS.manager)).status).toBe(404);
    expect((await call('post', '/orders/nope/receive', USERS.manager)).status).toBe(400);
  });

  it('CONCURRENCY: 30 rounds of 8 simultaneous clicks on «Receive» raise the stock exactly ONCE (one 200, seven 409) and publish one StockChanged', async () => {
    for (let round = 0; round < 30; round++) {
      await resetState(prisma);
      const id = (await order(SENSOR, 5)).body.id;
      const res = await Promise.all(Array.from({ length: 8 }, () => call('post', `/orders/${id}/receive`, USERS.manager)));
      const codes = res.map((r) => r.status);
      expect(codes.filter((c) => c === 200)).toHaveLength(1); expect(codes.filter((c) => c === 409)).toHaveLength(7);
      expect(await stock(SENSOR)).toBe(13);
      expect((await outbox()).filter((e) => e.type === 'StockChanged')).toHaveLength(1);
    }
  }, 180_000);

  it('CONCURRENCY: receiving and cancelling the same order at once → exactly one wins, and the stock matches the winner', async () => {
    for (let round = 0; round < 20; round++) {
      await resetState(prisma);
      const id = (await order(SENSOR, 5)).body.id;
      const res = await Promise.all([call('post', `/orders/${id}/receive`, USERS.manager), call('post', `/orders/${id}/cancel`, USERS.manager), call('post', `/orders/${id}/receive`, USERS.manager), call('post', `/orders/${id}/cancel`, USERS.manager)]);
      expect(res.filter((r) => r.status === 200)).toHaveLength(1);
      const status = (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;
      expect(await stock(SENSOR)).toBe(status === 'received' ? 13 : 8);
    }
  }, 180_000);

  it('adjustments: up and down with a reason; never below zero (409); StockChanged carries the reason', async () => {
    expect((await call('post', `/inventory/items/${PSU}/adjust`, USERS.manager, { delta: -3, reason: 'Stock count' })).body).toMatchObject({ onHand: 0 });
    expect((await call('post', `/inventory/items/${PSU}/adjust`, USERS.manager, { delta: -1, reason: 'Stock count' })).status).toBe(409);
    expect((await call('post', `/inventory/items/${PSU}/adjust`, USERS.manager, { delta: 2, reason: 'Return from site' })).body).toMatchObject({ onHand: 2 });
    for (const b of [{ delta: 0, reason: 'Nada que mover' }, { delta: 1.5, reason: 'Fraccion' }, { delta: 1, reason: 'ab' }, { delta: 1 }, { delta: 1, reason: 'Valid reason', extra: 1 }]) expect((await call('post', `/inventory/items/${PSU}/adjust`, USERS.manager, b)).status).toBe(400);
    expect((await call('post', `/inventory/items/${randomUUID()}/adjust`, USERS.manager, { delta: 1, reason: 'Unknown item' })).status).toBe(404);
    const ev = (await outbox()).map((e: any) => e.payload.data);
    expect(ev.map((d: any) => [d.delta, d.onHand, d.reason, d.note])).toEqual([[-3, 0, 'adjustment', 'Stock count'], [2, 2, 'adjustment', 'Return from site']]);
  });

  it('CONCURRENCY: 12 simultaneous −1 adjustments on 5 units → exactly 5 win, 7 get 409, the stock ends at 0 and is never negative', async () => {
    for (let round = 0; round < 20; round++) {
      await resetState(prisma);
      await prisma.item.update({ where: { id: SENSOR }, data: { onHand: 5 } });
      const res = await Promise.all(Array.from({ length: 12 }, () => call('post', `/inventory/items/${SENSOR}/adjust`, USERS.manager, { delta: -1, reason: 'Used on site' })));
      expect(res.filter((r) => r.status === 200)).toHaveLength(5); expect(res.filter((r) => r.status === 409)).toHaveLength(7);
      expect(await stock(SENSOR)).toBe(0);
      expect((await outbox()).filter((e) => e.type === 'StockChanged')).toHaveLength(5);
    }
  }, 180_000);

  describe('stock movement history', () => {
    const history = async (q = '', who: any = USERS.manager) => (await call('get', `/inventory/movements${q}`, who));
    const sumFor = async (id: string) => Number((await prisma.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(delta) AS s FROM stock_movements WHERE item_id = ${id}::uuid`)[0].s ?? 0);

    it('the seed opens each item with its balance; manager, lead and billing read, sales does not; bad filters are 400', async () => {
      const r = await history(); expect(r.status).toBe(200);
      expect(r.body.map((m: any) => [m.source, m.delta, m.onHandAfter]).sort()).toEqual([['opening', 2, 2], ['opening', 3, 3], ['opening', 8, 8]]);
      for (const u of [USERS.lead, USERS.billing]) expect((await history('', u)).status).toBe(200);
      expect((await history('', USERS.sales)).status).toBe(403);
      expect((await call('get', '/inventory/movements')).status).toBe(401);
      for (const q of ['?itemId=x', '?limit=0', '?limit=201', '?limit=abc', '?itemId=1;DROP']) expect((await history(q)).status).toBe(400);
    });

    it('receiving an order and adjusting by hand each leave one movement with who, what and the balance after; a refused move leaves none', async () => {
      const o = await order(SENSOR, 5); await call('post', `/orders/${o.body.id}/receive`, USERS.manager);
      await call('post', `/inventory/items/${SENSOR}/adjust`, USERS.manager, { delta: -4, reason: 'Used on site' });
      expect((await call('post', `/inventory/items/${PSU}/adjust`, USERS.manager, { delta: -99, reason: 'Too many' })).status).toBe(409);
      expect((await call('post', `/inventory/items/${PSU}/adjust`, USERS.manager, { delta: 0, reason: 'Nothing' })).status).toBe(400);
      const r = (await history(`?itemId=${SENSOR}`)).body;
      expect(r.map((m: any) => [m.source, m.delta, m.onHandAfter, m.actor])).toEqual([['adjustment', -4, 9, USERS.manager.email], ['purchase_received', 5, 13, USERS.manager.email], ['opening', 8, 8, null]]);
      expect(r[0].reason).toBe('Used on site'); expect(r[1].reason).toMatch(/^Pedido PO-\d{4} recibido$/);
      expect((await history(`?itemId=${PSU}`)).body).toHaveLength(1);
      expect(JSON.stringify(r)).not.toContain('payload');
    });

    it('INVARIANT: after 20 rounds of simultaneous receives and adjustments, the movements of every item add up exactly to its stock', async () => {
      for (let round = 0; round < 20; round++) {
        await resetState(prisma);
        const orders = await Promise.all([order(SENSOR, 3), order(SENSOR, 2)]);
        await Promise.all([...orders.map((o) => call('post', `/orders/${o.body.id}/receive`, USERS.manager)), ...orders.map((o) => call('post', `/orders/${o.body.id}/receive`, USERS.manager)),
          ...Array.from({ length: 8 }, () => call('post', `/inventory/items/${SENSOR}/adjust`, USERS.manager, { delta: -2, reason: 'Used on site' }))]);
        for (const id of SEED_ITEMS) expect(await sumFor(id)).toBe(await stock(id));
      }
    }, 180_000);

    it('the history is append-only: the database refuses UPDATE, DELETE and TRUNCATE', async () => {
      await expect(prisma.$executeRawUnsafe(`UPDATE stock_movements SET delta = 99`)).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM stock_movements`)).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`TRUNCATE stock_movements`)).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`INSERT INTO stock_movements (item_id, item_name, delta, on_hand_after, source, reason) VALUES (gen_random_uuid(),'x',0,0,'adjustment','r')`)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`INSERT INTO stock_movements (item_id, item_name, delta, on_hand_after, source, reason) VALUES (gen_random_uuid(),'x',1,-1,'adjustment','r')`)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`INSERT INTO stock_movements (item_id, item_name, delta, on_hand_after, source, reason) VALUES (gen_random_uuid(),'x',1,1,'magic','r')`)).rejects.toThrow();
    });
  });

  it('the database refuses what the code would never do (negative stock, a wrong total, a received order without a date)', async () => {
    await expect(prisma.$executeRaw`UPDATE items SET on_hand = -1 WHERE id = ${SENSOR}::uuid`).rejects.toBeTruthy();
    await expect(prisma.$executeRaw`INSERT INTO purchase_orders (supplier_id, item_id, quantity, unit_price_cop, total_cop) VALUES (${SEED_SUPPLIERS[0]}::uuid, ${SENSOR}::uuid, 2, 100, 999)`).rejects.toBeTruthy();
    const id = (await order()).body.id;
    await expect(prisma.$executeRaw`UPDATE purchase_orders SET status = 'received' WHERE id = ${id}::uuid`).rejects.toBeTruthy();
  });
});
