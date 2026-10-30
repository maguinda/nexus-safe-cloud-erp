import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, connect } from 'amqplib';
import request from 'supertest';
import { loadNetwork } from '../prisma/network-load';
import { purchaseEventHandler } from '../src/infrastructure/prisma-purchase-store';
import { PurchasesConsumer } from '../src/infrastructure/purchases-consumer';
import { bearer, token, USERS } from './helpers';

process.env.RATE_LIMIT = '100000';

describe('purchased equipment enters the network inventory (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  let consumer: PurchasesConsumer;
  const ev = (data: object = {}) => ({ eventId: randomUUID(), type: 'EquipmentPurchased', occurredAt: new Date().toISOString(), correlationId: 'corr-12345678', data: { orderNumber: 'PO-0091', orderId: randomUUID(), supplierName: 'Proveedor (example)', itemName: 'Switch Acceso 24p', quantity: 3, unitPriceCop: 1_000_000, totalCop: 3_000_000, ...data } });
  const publish = (e: object) => ch.publish('erp.events', 'procurement.equipment.purchased', Buffer.from(JSON.stringify(e)), { persistent: true });
  const until = async (f: () => Promise<boolean>, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const dlq = async () => (await ch.checkQueue('q.operations.purchases.dlq')).messageCount;
  const bought = () => prisma.networkDevice.count({ where: { sourceOrder: { not: null } } });
  const wipeBought = () => prisma.networkDevice.deleteMany({ where: { sourceOrder: { not: null } } });
  const get = (p: string, u: any) => request(app.getHttpServer()).get(p).set('Authorization', bearer(token(u)));

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init();
    if ((await prisma.networkDevice.count({ where: { sourceOrder: null } })) < 76) await loadNetwork(prisma);
    conn = await connect(process.env.RABBITMQ_URL as string); ch = await conn.createChannel(); await ch.assertExchange('erp.events', 'topic', { durable: true });
    consumer = new PurchasesConsumer(purchaseEventHandler(prisma), process.env.RABBITMQ_URL as string); consumer.start();
    await new Promise((r) => setTimeout(r, 1500)); await ch.purgeQueue('q.operations.purchases.dlq');
  });
  beforeEach(() => wipeBought());
  afterAll(async () => { await wipeBought(); await consumer.stop(); await ch.close(); await conn.close(); await app.close(); await prisma.$disconnect(); });

  it('each purchased unit becomes a device pending configuration; a repeated event does not duplicate; the manager sees them, nobody else', async () => {
    const e = ev(); const dead = await dlq();
    publish(e); publish(e);
    expect(await until(async () => (await bought()) === 3)).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await bought()).toBe(3); expect(await dlq()).toBe(dead);
    const rows = await prisma.networkDevice.findMany({ where: { sourceOrder: 'PO-0091' }, orderBy: { sourceUnit: 'asc' } });
    expect(rows.map((r) => r.name)).toEqual(['Switch Acceso 24p (PO-0091-1)', 'Switch Acceso 24p (PO-0091-2)', 'Switch Acceso 24p (PO-0091-3)']);
    expect(rows[0]).toMatchObject({ model: 'Switch Acceso 24p', category: 'Equipo comprado', role: 'Pendiente de configurar', criticality: 'Media', serial: 'PO-0091-1', ips: null });
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    const list = await get('/network/devices?q=PO-0091', USERS.manager); expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('Switch Acceso 24p (PO-0091-1)');
    for (const u of [USERS.lead, USERS.billing, USERS.sales]) expect((await get('/network/devices', u)).status).toBe(403);
  });

  it('invalid purchases (too many units, bad order, markup, not JSON) go to the dead-letter queue and store nothing', async () => {
    const dead = await dlq();
    publish(ev({ quantity: 101 })); publish(ev({ orderNumber: 'nope' })); publish(ev({ itemName: '<script>' })); ch.publish('erp.events', 'procurement.equipment.purchased', Buffer.from('no es json'), { persistent: true });
    expect(await until(async () => (await dlq()) === dead + 4)).toBe(true);
    expect(await bought()).toBe(0);
    publish(ev({ orderNumber: 'PO-0092', quantity: 1 })); expect(await until(async () => (await bought()) === 1)).toBe(true);
  });

  it('CONCURRENCY: 30 rounds of 4 purchases at the same time never collide on ids and never lose a unit', async () => {
    const h = purchaseEventHandler(prisma);
    for (let r = 0; r < 30; r++) {
      await wipeBought();
      const orders = [1, 2, 3, 4].map((n) => ev({ orderNumber: `PO-${String(100 + n).padStart(4, '0')}`, quantity: 2 + (n % 2), itemName: `Equipo ${n}` }));
      await Promise.all([...orders, orders[0], orders[1]].map((o) => h(o)));
      expect(await bought()).toBe(3 + 2 + 3 + 2);
      const ids = (await prisma.networkDevice.findMany({ select: { id: true } })).map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  }, 120_000);

  it('the database refuses an unit number out of range or an order that does not look like PO-0001', async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO network_devices (id, name, pt_type, model, category, role, criticality, serial, source_order, source_unit) VALUES (99001,'x','p','m','c','r','Media','s','PO-0001',0)`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO network_devices (id, name, pt_type, model, category, role, criticality, serial, source_order, source_unit) VALUES (99002,'y','p','m','c','r','Media','s','mala',1)`)).rejects.toThrow();
  });
});

describe('completing a purchased device (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const body = { role: 'Switch de acceso piso 2', criticality: 'Alta', ips: '10.0.2.5' };
  const patch = (id: number, u: any, b: object = body) => request(app.getHttpServer()).patch(`/network/devices/${id}/configure`).set('Authorization', bearer(token(u))).send(b);
  let boughtId = 0; let excelId = 0;

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init();
    if ((await prisma.networkDevice.count({ where: { sourceOrder: null } })) < 76) await loadNetwork(prisma);
    excelId = (await prisma.networkDevice.findFirstOrThrow({ where: { sourceOrder: null } })).id;
  });
  beforeEach(async () => {
    await prisma.networkDevice.deleteMany({ where: { sourceOrder: { not: null } } });
    await purchaseEventHandler(prisma)({ type: 'EquipmentPurchased', data: { orderNumber: 'PO-0555', itemName: 'Switch Acceso 24p', quantity: 1 } });
    boughtId = (await prisma.networkDevice.findFirstOrThrow({ where: { sourceOrder: 'PO-0555' } })).id;
  });
  afterAll(async () => { await prisma.networkDevice.deleteMany({ where: { sourceOrder: { not: null } } }); await app.close(); await prisma.$disconnect(); });

  it('only the manager completes it: 401 without token, 403 for other roles', async () => {
    expect((await request(app.getHttpServer()).patch(`/network/devices/${boughtId}/configure`).send(body)).status).toBe(401);
    for (const u of [USERS.lead, USERS.billing, USERS.sales]) expect((await patch(boughtId, u)).status).toBe(403);
    expect((await prisma.networkDevice.findUniqueOrThrow({ where: { id: boughtId } })).role).toBe('Pendiente de configurar');
  });

  it('the manager sets role, criticality and IPs; the device stops being pending; the name and model stay', async () => {
    const r = await patch(boughtId, USERS.manager); expect(r.status).toBe(200);
    expect(await prisma.networkDevice.findUniqueOrThrow({ where: { id: boughtId } })).toMatchObject({ role: 'Switch de acceso piso 2', criticality: 'Alta', ips: '10.0.2.5', name: 'Switch Acceso 24p (PO-0555-1)', model: 'Switch Acceso 24p', sourceOrder: 'PO-0555' });
    expect((await patch(boughtId, USERS.manager, { ...body, ips: '' })).status).toBe(200);
    expect((await prisma.networkDevice.findUniqueOrThrow({ where: { id: boughtId } })).ips).toBeNull();
  });

  it('a device from the teacher\'s Excel or an unknown id cannot be edited here (404) and stays untouched', async () => {
    const before = await prisma.networkDevice.findUniqueOrThrow({ where: { id: excelId } });
    expect((await patch(excelId, USERS.manager)).status).toBe(404);
    expect((await patch(999999, USERS.manager)).status).toBe(404);
    expect(await prisma.networkDevice.findUniqueOrThrow({ where: { id: excelId } })).toEqual(before);
  });

  it.each<[string, object]>([['role pending', { role: 'Pendiente de configurar' }], ['bad criticality', { criticality: 'Baja' }], ['bad ip', { ips: '10.0.0.300' }], ['markup role', { role: '<script>' }], ['no role', { role: undefined }], ['extra field', { extra: 1 }]])('400 and nothing changes: %s', async (_n, over) => {
    const r = await patch(boughtId, USERS.manager, { ...body, ...over }); expect(r.status).toBe(400);
    expect((await prisma.networkDevice.findUniqueOrThrow({ where: { id: boughtId } })).role).toBe('Pendiente de configurar');
  });
  it('a bad id is 400', async () => { expect((await request(app.getHttpServer()).patch('/network/devices/abc/configure').set('Authorization', bearer(token(USERS.manager))).send(body)).status).toBe(400); });

  describe('serial, warranty and assignee per unit', () => {
    const list = (u: any = USERS.manager) => request(app.getHttpServer()).get('/network/purchased').set('Authorization', bearer(token(u)));
    const unit2 = async () => { await purchaseEventHandler(prisma)({ type: 'EquipmentPurchased', data: { orderNumber: 'PO-0556', itemName: 'Router edge', quantity: 1 } }); return (await prisma.networkDevice.findFirstOrThrow({ where: { sourceOrder: 'PO-0556' } })).id; };

    it('only the manager lists the purchased units: 401 without token, 403 for other roles; the Excel devices are not in the list', async () => {
      expect((await request(app.getHttpServer()).get('/network/purchased')).status).toBe(401);
      for (const u of [USERS.lead, USERS.billing, USERS.sales]) expect((await list(u)).status).toBe(403);
      const r = await list(); expect(r.status).toBe(200);
      expect(r.body).toEqual([expect.objectContaining({ id: boughtId, order: 'PO-0555', unit: 1, serial: 'PO-0555-1', warrantyUntil: null, assignedTo: null })]);
    });

    it('sets the real serial, the warranty and the assignee; a later edit that does not send them keeps them; empty clears warranty and assignee', async () => {
      expect((await patch(boughtId, USERS.manager, { ...body, serial: 'FOC2145X0AB', warrantyUntil: '2028-11-30', assignedTo: 'Laura Ríos' })).status).toBe(200);
      expect((await list()).body[0]).toMatchObject({ serial: 'FOC2145X0AB', warrantyUntil: '2028-11-30', assignedTo: 'Laura Ríos' });
      expect((await patch(boughtId, USERS.manager, { ...body, criticality: 'Crítica' })).status).toBe(200);
      expect((await list()).body[0]).toMatchObject({ criticality: 'Crítica', serial: 'FOC2145X0AB', warrantyUntil: '2028-11-30', assignedTo: 'Laura Ríos' });
      expect((await patch(boughtId, USERS.manager, { ...body, warrantyUntil: '', assignedTo: null })).status).toBe(200);
      expect((await list()).body[0]).toMatchObject({ serial: 'FOC2145X0AB', warrantyUntil: null, assignedTo: null });
    });

    it.each<[string, object]>([['bad serial', { serial: 'a b' }], ['impossible date', { warrantyUntil: '2028-02-30' }], ['markup person', { assignedTo: '<script>' }]])('400 and nothing changes: %s', async (_n, over) => {
      expect((await patch(boughtId, USERS.manager, { ...body, ...over })).status).toBe(400);
      expect((await list()).body[0]).toMatchObject({ role: 'Pendiente de configurar', serial: 'PO-0555-1', warrantyUntil: null, assignedTo: null });
    });

    it('a serial number cannot belong to two purchased devices (any case): 409 and the second keeps its own', async () => {
      const other = await unit2();
      expect((await patch(boughtId, USERS.manager, { ...body, serial: 'SN-ABC-123' })).status).toBe(200);
      expect((await patch(other, USERS.manager, { ...body, serial: 'sn-abc-123' })).status).toBe(409);
      expect((await prisma.networkDevice.findUniqueOrThrow({ where: { id: other } })).serial).toBe('PO-0556-1');
      expect((await patch(boughtId, USERS.manager, { ...body, serial: 'SN-ABC-123' })).status).toBe(200); // el mismo equipo puede repetir su propio serial
    });

    it('CONCURRENCY: 30 rounds of two devices taking the same serial at once → exactly one gets it', async () => {
      const other = await unit2();
      for (let r = 0; r < 30; r++) {
        await prisma.networkDevice.update({ where: { id: boughtId }, data: { serial: `TMP-A-${r}-000` } }); await prisma.networkDevice.update({ where: { id: other }, data: { serial: `TMP-B-${r}-000` } });
        const res = await Promise.all([patch(boughtId, USERS.manager, { ...body, serial: `RACE-${r}-0001` }), patch(other, USERS.manager, { ...body, serial: `race-${r}-0001` })]);
        expect(res.filter((x) => x.status === 200)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(1);
        expect(await prisma.networkDevice.count({ where: { serial: { equals: `RACE-${r}-0001`, mode: 'insensitive' } } })).toBe(1);
      }
    }, 120_000);

    it('the database only lets purchased units carry a warranty or an assignee, and keeps names within limits', async () => {
      await expect(prisma.networkDevice.update({ where: { id: excelId }, data: { assignedTo: 'Alguien' } })).rejects.toThrow();
      await expect(prisma.networkDevice.update({ where: { id: excelId }, data: { warrantyUntil: new Date('2030-01-01') } })).rejects.toThrow();
      await expect(prisma.networkDevice.update({ where: { id: boughtId }, data: { assignedTo: 'x' } })).rejects.toThrow();
    });
  });
});
