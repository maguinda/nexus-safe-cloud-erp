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
