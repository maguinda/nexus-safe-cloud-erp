import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, resetState, SEED_ITEMS, SEED_SUPPLIERS, token, USERS } from './helpers';

process.env.RATE_LIMIT = '100000';

describe('supplier catalog and equipment installation (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const M = USERS.manager;
  const as = (u: any) => bearer(token(u));
  const call = (m: 'get' | 'post' | 'put' | 'delete' | 'patch', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', as(who)); return body ? r.send(body) : r; };
  const [SENSOR, PSU, SWITCH] = SEED_ITEMS; const [REDES, ANDINA] = SEED_SUPPLIERS;
  const order = (supplierId: string, itemId: string, extra: object = {}) => call('post', '/orders', M, { supplierId, itemId, quantity: 2, ...extra });
  const install = (id = SWITCH, who: any = M) => call('post', `/inventory/items/${id}/install`, who);
  const stock = async (id: string) => (await prisma.item.findUniqueOrThrow({ where: { id } })).onHand;
  const sumMov = async (id: string) => Number((await prisma.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(delta) AS s FROM stock_movements WHERE item_id = ${id}::uuid`)[0].s ?? 0);

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('catalog per supplier', () => {
    it('every reader sees what each supplier sells (with price and delivery time) and the tender data; both suppliers sell the sensor and the power supply', async () => {
      for (const u of [M, USERS.lead, USERS.billing]) {
        const r = await call('get', '/suppliers', u); expect(r.status).toBe(200);
        const redes = r.body.find((s: any) => s.id === REDES), andina = r.body.find((s: any) => s.id === ANDINA);
        expect(redes).toMatchObject({ kind: 'fixed', tenderRef: null, validUntil: null }); expect(andina).toMatchObject({ kind: 'tender', tenderRef: 'LIC-2026-014', validUntil: '2027-06-30' });
        expect(redes.catalog.map((c: any) => [c.itemName, c.refPriceCop, c.leadDays]).sort()).toEqual([['Fuente de poder 12 V', 180000, 5], ['Sensor de temperatura TH-10', 120000, 5], ['Switch de acceso 24 puertos', 2400000, 5]]);
        expect(andina.catalog.map((c: any) => c.itemName).sort()).toEqual(['Fuente de poder 12 V', 'Sensor de temperatura TH-10']);
      }
      expect((await call('get', '/suppliers', USERS.sales)).status).toBe(403);
    });

    it('only the manager edits the catalog: 401, 403 for the rest; the manager adds, changes the price and removes', async () => {
      const url = `/suppliers/${ANDINA}/catalog/${SWITCH}`;
      expect((await call('put', url, undefined, { refPriceCop: 1, leadDays: 1 })).status).toBe(401);
      for (const u of [USERS.lead, USERS.billing, USERS.sales]) { expect((await call('put', url, u, { refPriceCop: 1, leadDays: 1 })).status).toBe(403); expect((await call('delete', url, u)).status).toBe(403); }
      expect((await call('put', url, M, { refPriceCop: 2_300_000, leadDays: 15 })).status).toBe(200);
      expect((await call('put', url, M, { refPriceCop: 2_250_000, leadDays: 20 })).status).toBe(200); // cambiar el precio
      expect(await prisma.supplierItem.findMany({ where: { supplierId: ANDINA, itemId: SWITCH } })).toEqual([{ supplierId: ANDINA, itemId: SWITCH, refPriceCop: 2_250_000, leadDays: 20 }]);
      expect((await call('delete', url, M)).status).toBe(204); expect((await call('delete', url, M)).status).toBe(404);
    });

    it.each<[string, object]>([['price 0', { refPriceCop: 0 }], ['price decimal', { refPriceCop: 1.5 }], ['price text', { refPriceCop: '100' }], ['price huge', { refPriceCop: 1_000_000_001 }], ['lead negative', { leadDays: -1 }],
      ['lead 366', { leadDays: 366 }], ['lead decimal', { leadDays: 1.5 }], ['lead null', { leadDays: null }], ['no price', { refPriceCop: undefined }], ['extra field', { extra: 1 }]])('400 and nothing changes: %s', async (_n, over) => {
      const r = await call('put', `/suppliers/${ANDINA}/catalog/${SWITCH}`, M, { refPriceCop: 100_000, leadDays: 3, ...over }); expect(r.status).toBe(400);
      expect(await prisma.supplierItem.count({ where: { supplierId: ANDINA, itemId: SWITCH } })).toBe(0);
    });
    it('unknown supplier or item is 404; malformed ids are 400', async () => {
      expect((await call('put', `/suppliers/${randomUUID()}/catalog/${SWITCH}`, M, { refPriceCop: 5, leadDays: 1 })).status).toBe(404);
      expect((await call('put', `/suppliers/${ANDINA}/catalog/${randomUUID()}`, M, { refPriceCop: 5, leadDays: 1 })).status).toBe(404);
      expect((await call('put', `/suppliers/x/catalog/${SWITCH}`, M, { refPriceCop: 5, leadDays: 1 })).status).toBe(400);
      expect((await call('put', `/suppliers/${ANDINA}/catalog/zz`, M, { refPriceCop: 5, leadDays: 1 })).status).toBe(400);
    });

    it('an order only accepts what the supplier sells (409 otherwise); without a price it takes the supplier\'s reference price; an explicit price is kept', async () => {
      expect((await order(ANDINA, SWITCH, { unitPriceCop: 100 })).status).toBe(409); // Andina no vende el switch
      expect(await prisma.purchaseOrder.count()).toBe(0);
      const a = await order(REDES, SWITCH); expect(a.status).toBe(201); expect(a.body).toMatchObject({ unitPriceCop: 2_400_000, totalCop: 4_800_000 });
      const b = await order(ANDINA, SENSOR); expect(b.body).toMatchObject({ unitPriceCop: 95_000 }); // el mismo sensor, otro proveedor, otro precio
      const c = await order(ANDINA, SENSOR, { unitPriceCop: 90_000 }); expect(c.body).toMatchObject({ unitPriceCop: 90_000, totalCop: 180_000 });
      await call('delete', `/suppliers/${ANDINA}/catalog/${SENSOR}`, M);
      expect((await order(ANDINA, SENSOR)).status).toBe(409); // ya no lo vende
      expect(await prisma.purchaseOrder.count()).toBe(3); // los pedidos anteriores no se tocan
    });

    it('suppliers by tender can carry a reference and an end date; a fixed supplier cannot; strange values are refused', async () => {
      const ok = await call('post', '/suppliers', M, { name: 'Licitación Nueva', kind: 'tender', terms: 'x y', tenderRef: ' LIC-2027-001 ', validUntil: '2027-12-31' }); expect(ok.status).toBe(201);
      expect((await call('get', '/suppliers', M)).body.find((s: any) => s.name === 'Licitación Nueva')).toMatchObject({ tenderRef: 'LIC-2027-001', validUntil: '2027-12-31', catalog: [] });
      for (const b of [{ kind: 'fixed', tenderRef: 'LIC-1' }, { kind: 'fixed', validUntil: '2027-01-01' }, { kind: 'tender', validUntil: '2027-02-30' }, { kind: 'tender', validUntil: 'mañana' }, { kind: 'tender', tenderRef: '<b>x</b>' }, { kind: 'tender', tenderRef: 'a' }, { kind: 'tender', validUntil: '2101-01-01' }])
        expect((await call('post', '/suppliers', M, { name: 'Malo ' + randomUUID().slice(0, 4), ...b })).status).toBe(400);
      await expect(prisma.$executeRawUnsafe(`INSERT INTO suppliers (name, kind, tender_ref) VALUES ('Fijo con licitación', 'fixed', 'LIC-9')`)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`INSERT INTO supplier_items (supplier_id, item_id, ref_price_cop, lead_days) VALUES ('${REDES}', '${SWITCH}', 5, 1)`)).rejects.toThrow(); // ya existe
      await expect(prisma.$executeRawUnsafe(`INSERT INTO supplier_items (supplier_id, item_id, ref_price_cop, lead_days) VALUES ('${ANDINA}', '${SWITCH}', 0, 1)`)).rejects.toThrow();
    });
  });

  describe('installing equipment: from storage to installed', () => {
    it('receiving an equipment order only raises the storage stock; installing one unit lowers it, writes the movement and publishes StockChanged and EquipmentInstalled with INS-0001', async () => {
      const o = await order(REDES, SWITCH); await call('post', `/orders/${o.body.id}/receive`, M);
      expect(await stock(SWITCH)).toBe(4);
      const r = await install(); expect(r.status).toBe(200); expect(r.body).toMatchObject({ installNumber: expect.stringMatching(/^INS-\d{4}$/), itemName: 'Switch de acceso 24 puertos', onHand: 3 });
      expect(await stock(SWITCH)).toBe(3);
      const mv = await prisma.stockMovement.findFirstOrThrow({ where: { source: 'install' } }); expect(mv).toMatchObject({ delta: -1, onHandAfter: 3, actor: M.email, reason: `Instalación ${r.body.installNumber}` });
      const ev = await prisma.outboxEvent.findMany({ where: { type: { in: ['StockChanged', 'EquipmentInstalled'] } }, orderBy: { createdAt: 'asc' } });
      const inst = ev.find((e) => e.type === 'EquipmentInstalled')!, stk = ev.filter((e: any) => e.type === 'StockChanged').find((e: any) => e.payload.data.reason === 'installation')!;
      expect(inst.routingKey).toBe('procurement.equipment.installed'); expect((inst.payload as any).data).toMatchObject({ installNumber: r.body.installNumber, itemId: SWITCH, itemName: 'Switch de acceso 24 puertos' });
      expect((stk.payload as any).data).toMatchObject({ delta: -1, onHand: 3, reason: 'installation' });
      expect(await prisma.equipmentInstall.count()).toBe(1);
      for (const id of SEED_ITEMS) expect(await sumMov(id)).toBe(await stock(id));
    });

    it('only the manager installs (401/403); a spare part cannot be installed (409); unknown or malformed item is 404/400; nothing is left behind by a refusal', async () => {
      expect((await call('post', `/inventory/items/${SWITCH}/install`)).status).toBe(401);
      for (const u of [USERS.lead, USERS.billing, USERS.sales]) expect((await install(SWITCH, u)).status).toBe(403);
      const sp = await install(SENSOR); expect(sp.status).toBe(409); expect(sp.body.message).toMatch(/spare part/);
      expect((await install(randomUUID())).status).toBe(404); expect((await call('post', '/inventory/items/zz/install', M)).status).toBe(400);
      expect(await stock(SENSOR)).toBe(8); expect(await stock(SWITCH)).toBe(2);
      expect(await prisma.equipmentInstall.count()).toBe(0); expect(await prisma.outboxEvent.count()).toBe(0); expect(await prisma.stockMovement.count({ where: { source: 'install' } })).toBe(0);
    });

    it('with no stock it is refused (409) and the stock never goes below zero', async () => {
      expect((await install()).status).toBe(200); expect((await install()).status).toBe(200);
      const r = await install(); expect(r.status).toBe(409); expect(r.body.message).toMatch(/has 0 in stock/);
      expect(await stock(SWITCH)).toBe(0); expect(await prisma.equipmentInstall.count()).toBe(2);
    });

    it('CONCURRENCY: 20 rounds of 12 simultaneous installs on 2 units → exactly 2 win, 10 get 409, two different INS numbers, two events each, stock 0', async () => {
      for (let r = 0; r < 20; r++) {
        await resetState(prisma);
        const res = await Promise.all(Array.from({ length: 12 }, () => install()));
        expect(res.filter((x) => x.status === 200)).toHaveLength(2); expect(res.filter((x) => x.status === 409)).toHaveLength(10);
        expect(await stock(SWITCH)).toBe(0);
        const nums = res.filter((x) => x.status === 200).map((x) => x.body.installNumber); expect(new Set(nums).size).toBe(2);
        expect(await prisma.outboxEvent.count({ where: { type: 'EquipmentInstalled' } })).toBe(2);
        expect(await sumMov(SWITCH)).toBe(0);
      }
    }, 180_000);

    it('CONCURRENCY: installs, adjustments, receives and a physical count at once → no deadlock and the history always adds up to the stock', async () => {
      for (let r = 0; r < 15; r++) {
        await resetState(prisma);
        const c = (await call('post', '/counts', M)).body; await call('patch', `/counts/${c.id}/lines/${SWITCH}`, M, { counted: 1 });
        const o = await order(REDES, SWITCH);
        const res = await Promise.all([install(), install(), call('post', `/orders/${o.body.id}/receive`, M), call('post', `/inventory/items/${SWITCH}/adjust`, M, { delta: -1, reason: 'Used on site' }), call('post', `/counts/${c.id}/close`, M)]);
        for (const x of res) expect([200, 409]).toContain(x.status);
        for (const id of SEED_ITEMS) { expect(await stock(id)).toBeGreaterThanOrEqual(0); expect(await sumMov(id)).toBe(await stock(id)); }
      }
    }, 240_000);

    it('the database refuses the install movement with a wrong sign data and keeps install numbers unique', async () => {
      await expect(prisma.$executeRawUnsafe(`INSERT INTO stock_movements (item_id, item_name, delta, on_hand_after, source, reason) VALUES (gen_random_uuid(),'x',-1,-1,'install','r')`)).rejects.toThrow();
      await prisma.$executeRawUnsafe(`INSERT INTO equipment_installs (number, item_id, item_name) VALUES (9001, gen_random_uuid(), 'x')`);
      await expect(prisma.$executeRawUnsafe(`INSERT INTO equipment_installs (number, item_id, item_name) VALUES (9001, gen_random_uuid(), 'y')`)).rejects.toThrow();
    });
  });

  describe('taking an installed unit out of service', () => {
    const retire = (id: string, destination: unknown = 'storage', who: any = M) => call('post', `/installs/${id}/retire`, who, { destination });
    const installs = async () => (await call('get', '/installs', M)).body as any[];

    it('lists the installs (readers) with their status; sales does not read; bad filters are 400', async () => {
      await install(); await install();
      for (const u of [M, USERS.lead, USERS.billing]) { const r = await call('get', '/installs', u); expect(r.status).toBe(200); expect(r.body.map((x: any) => x.status)).toEqual(['installed', 'installed']); }
      expect((await call('get', '/installs', USERS.sales)).status).toBe(403); expect((await call('get', '/installs')).status).toBe(401);
      expect((await call('get', `/installs?itemId=${SWITCH}`, M)).body).toHaveLength(2); expect((await call('get', `/installs?itemId=${SENSOR}`, M)).body).toHaveLength(0);
      for (const q of ['?itemId=x', '?limit=0', '?limit=201', '?limit=abc']) expect((await call('get', `/installs${q}`, M)).status).toBe(400);
    });

    it('returning to storage raises the stock by one, writes the movement and publishes StockChanged (return) and EquipmentRetired; the history still adds up', async () => {
      const i = await install(); const [inst] = await installs(); expect(await stock(SWITCH)).toBe(1);
      const r = await retire(inst.id, 'storage'); expect(r.status).toBe(200); expect(r.body).toMatchObject({ installNumber: i.body.installNumber, destination: 'storage', onHand: 2 });
      expect(await stock(SWITCH)).toBe(2);
      expect(await prisma.stockMovement.findFirstOrThrow({ where: { source: 'return' } })).toMatchObject({ delta: 1, onHandAfter: 2, actor: M.email, reason: `Devolución ${i.body.installNumber}` });
      const ev = await prisma.outboxEvent.findFirstOrThrow({ where: { type: 'EquipmentRetired' } });
      expect(ev.routingKey).toBe('procurement.equipment.retired'); expect((ev.payload as any).data).toEqual({ installNumber: i.body.installNumber, itemId: SWITCH, itemName: 'Switch de acceso 24 puertos', destination: 'storage' });
      expect((await prisma.outboxEvent.findMany({ where: { type: 'StockChanged' } })).some((e: any) => e.payload.data.reason === 'return' && e.payload.data.delta === 1)).toBe(true);
      expect((await installs())[0]).toMatchObject({ status: 'returned', endedBy: M.email });
      for (const id of SEED_ITEMS) expect(await sumMov(id)).toBe(await stock(id));
    });

    it('retiring (out of service) does not touch the stock and publishes only EquipmentRetired', async () => {
      await install(); const [inst] = await installs(); const before = await prisma.outboxEvent.count({ where: { type: 'StockChanged' } });
      expect((await retire(inst.id, 'retired')).body).toMatchObject({ destination: 'retired', onHand: 1 });
      expect(await stock(SWITCH)).toBe(1); expect(await prisma.outboxEvent.count({ where: { type: 'StockChanged' } })).toBe(before); expect(await prisma.stockMovement.count({ where: { source: 'return' } })).toBe(0);
      expect((await installs())[0].status).toBe('retired');
    });

    it('only the manager (401/403); a unit that is not installed any more is 409; unknown 404; bad destination or id 400; nothing is left by a refusal', async () => {
      await install(); const [inst] = await installs();
      expect((await call('post', `/installs/${inst.id}/retire`, undefined, { destination: 'storage' })).status).toBe(401);
      for (const u of [USERS.lead, USERS.billing, USERS.sales]) expect((await retire(inst.id, 'storage', u)).status).toBe(403);
      for (const d of ['bodega', '', null, 5]) expect((await retire(inst.id, d)).status).toBe(400);
      expect((await retire(randomUUID())).status).toBe(404); expect((await call('post', '/installs/zz/retire', M, { destination: 'storage' })).status).toBe(400);
      expect((await installs())[0].status).toBe('installed'); expect(await stock(SWITCH)).toBe(1);
      expect((await retire(inst.id, 'retired')).status).toBe(200);
      for (const d of ['storage', 'retired']) expect((await retire(inst.id, d)).status).toBe(409); // ya no está instalada
      expect(await stock(SWITCH)).toBe(1);
    });

    it('CONCURRENCY: 20 rounds of 8 simultaneous returns of the same unit → exactly one wins, the stock rises once, one EquipmentRetired', async () => {
      for (let r = 0; r < 20; r++) {
        await resetState(prisma); await install(); const [inst] = await installs();
        const res = await Promise.all(Array.from({ length: 8 }, (_, k) => retire(inst.id, k % 2 ? 'storage' : 'retired')));
        expect(res.filter((x) => x.status === 200)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
        expect(await prisma.outboxEvent.count({ where: { type: 'EquipmentRetired' } })).toBe(1);
        const final = (await installs())[0].status; expect(await stock(SWITCH)).toBe(final === 'returned' ? 2 : 1);
        for (const id of SEED_ITEMS) expect(await sumMov(id)).toBe(await stock(id));
      }
    }, 180_000);

    it('CONCURRENCY: installs and returns at once never deadlock and the history always adds up to the stock', async () => {
      for (let r = 0; r < 15; r++) {
        await resetState(prisma); await install(); await install(); const list = await installs();
        const res = await Promise.all([install(), install(), retire(list[0].id, 'storage'), retire(list[1].id, 'storage'), call('post', `/inventory/items/${SWITCH}/adjust`, M, { delta: 1, reason: 'Return from site' })]);
        for (const x of res) expect([200, 409]).toContain(x.status);
        expect(await stock(SWITCH)).toBeGreaterThanOrEqual(0); for (const id of SEED_ITEMS) expect(await sumMov(id)).toBe(await stock(id));
      }
    }, 240_000);

    it('the database refuses an install that is closed without a date or open with one', async () => {
      await install(); const [inst] = await installs();
      await expect(prisma.$executeRawUnsafe(`UPDATE equipment_installs SET status = 'returned' WHERE id = '${inst.id}'`)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`UPDATE equipment_installs SET ended_at = now() WHERE id = '${inst.id}'`)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`UPDATE equipment_installs SET status = 'lost', ended_at = now() WHERE id = '${inst.id}'`)).rejects.toThrow();
    });
  });
});
