import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, connect } from 'amqplib';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'true';
process.env.RATE_LIMIT = '100000';
const EXCHANGE = 'erp.events', AUDIT_QUEUE = 'q.analytics.audit', AUDIT_DLQ = 'q.analytics.audit.dlq';

describe('audit log from every event on the bus (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  const ev = (type: string, data: object, over: object = {}) => ({ eventId: randomUUID(), type, occurredAt: new Date().toISOString(), correlationId: 'trace-au-0001', data, ...over });
  const publish = (key: string, e: object) => ch.publish(EXCHANGE, key, Buffer.from(JSON.stringify(e)), { persistent: true });
  const until = async (f: () => Promise<boolean>, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const get = (p: string, who?: any) => { let r = request(app.getHttpServer()).get(p); if (who) r = r.set('Authorization', bearer(token(who))); return r; };
  const has = async (id: string) => (await prisma.auditEntry.count({ where: { eventId: id } })) === 1;
  const dlq = async () => (await ch.checkQueue(AUDIT_DLQ)).messageCount;

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init();
    conn = await connect(process.env.RABBITMQ_URL as string); ch = await conn.createChannel(); await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
    const exists = async () => { const c = await conn.createChannel(); c.on('error', () => undefined); try { await c.checkQueue(AUDIT_QUEUE); await c.close(); return true; } catch { return false; } };
    expect(await until(exists)).toBe(true);
  });
  beforeEach(async () => { await ch.purgeQueue(AUDIT_DLQ); await resetState(prisma); });
  afterAll(async () => { await resetState(prisma); await ch.close(); await conn.close(); await app.close(); await prisma.$disconnect(); });

  it('only the manager reads it: 401 without token, 403 for the other roles; bad filters are 400', async () => {
    expect((await get('/audit')).status).toBe(401);
    for (const u of [USERS.lead, USERS.billing, USERS.sales]) expect((await get('/audit', u)).status).toBe(403);
    expect((await get('/audit', USERS.manager)).status).toBe(200);
    for (const q of ['type=<b>', 'type=Type1', 'limit=0', 'limit=201', 'limit=abc', 'limit=-1']) expect((await get(`/audit?${q}`, USERS.manager)).status).toBe(400);
  });

  it('every event type is logged (even one nobody knows) with who, what and when; a repeated event is one row', async () => {
    const issued = ev('InvoiceIssued', { invoiceNumber: 'INV-0103', totalCop: 22_015_000, issuedBy: 'andres.mora@nexus.example', note: 'no se guarda' });
    const alloc = ev('EngineerAllocated', { engineerName: 'Ana Torres', projectName: 'Branch network upgrade', percent: 50 });
    const unknown = ev('BrandNewThing', { x: 1 });
    const dead = await dlq();
    publish('billing.invoice.issued', issued); publish('billing.invoice.issued', issued); publish('capacity.engineer.allocated', alloc); publish('something.new.here', unknown);
    expect(await until(async () => (await has(issued.eventId)) && (await has(alloc.eventId)) && (await has(unknown.eventId)))).toBe(true);
    await new Promise((r) => setTimeout(r, 2500));
    expect(await prisma.auditEntry.count()).toBe(3);
    expect(await dlq()).toBe(dead); // el repetido se confirma como duplicado, no va a mensajes muertos
    const r = (await get('/audit', USERS.manager)).body;
    const row = (id: string) => r.entries.find((e: any) => e.eventId === id);
    expect(row(issued.eventId)).toMatchObject({ type: 'InvoiceIssued', actor: 'andres.mora@nexus.example', summary: 'Invoice INV-0103 issued (22.015.000 COP)' });
    expect(row(alloc.eventId)).toMatchObject({ type: 'EngineerAllocated', actor: null, summary: 'Ana Torres allocated to Branch network upgrade at 50%' });
    expect(row(unknown.eventId)).toMatchObject({ type: 'BrandNewThing', summary: 'Event BrandNewThing' });
    expect(JSON.stringify(r)).not.toContain('no se guarda');
    expect(r.types).toEqual(['BrandNewThing', 'EngineerAllocated', 'InvoiceIssued']);
    const f = (await get('/audit?type=InvoiceIssued&limit=1', USERS.manager)).body; expect(f.entries).toHaveLength(1); expect(f.entries[0].type).toBe('InvoiceIssued');
    expect(r.entries[0].occurredAt >= r.entries[1].occurredAt).toBe(true); // lo más reciente primero
  });

  it('the log is append-only: the database refuses UPDATE, DELETE and TRUNCATE', async () => {
    const e = ev('InvoiceIssued', { invoiceNumber: 'INV-0104', totalCop: 1000 }); publish('billing.invoice.issued', e);
    expect(await until(() => has(e.eventId))).toBe(true);
    await expect(prisma.$executeRaw`UPDATE audit_entries SET summary = 'borrado' WHERE event_id = ${e.eventId}::uuid`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM audit_entries WHERE event_id = ${e.eventId}::uuid`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_entries')).rejects.toThrow(/append-only/);
    expect(await has(e.eventId)).toBe(true);
  });

  it('an invalid message goes to the audit dead-letter queue, stores nothing and does not block the next valid one', async () => {
    const before = await dlq();
    publish('x.y', ev('Bad1', {})); publish('x.y', { not: 'an event' }); ch.publish(EXCHANGE, 'x.y', Buffer.from('no es json'), { persistent: true });
    expect(await until(async () => (await dlq()) === before + 3)).toBe(true);
    expect(await prisma.auditEntry.count()).toBe(0);
    const ok = ev('StockChanged', { itemName: 'Router', delta: 5 }); publish('procurement.stock.changed', ok);
    expect(await until(() => has(ok.eventId))).toBe(true);
  });
});
