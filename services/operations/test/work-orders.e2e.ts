import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { loadNetwork } from '../prisma/network-load';
import { bearer, token, USERS } from './helpers';

process.env.RATE_LIMIT = '100000';

describe('work orders from the monitoring screens (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const M = USERS.manager;
  let sensorId = ''; let sensorName = ''; let deviceId = 0; let deviceName = '';
  const as = (u: any) => bearer(token(u));
  const call = (m: 'get' | 'post' | 'patch', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', as(who)); return body ? r.send(body) : r; };
  const body = (o: object = {}) => ({ type: 'corrective', targetKind: 'sensor', targetRef: sensorId, description: 'Temperatura sobre el umbral', ...o });
  const create = (o: object = {}, who: any = M) => call('post', '/work-orders', who, body(o));
  const wipe = async () => { await prisma.workOrder.deleteMany(); await prisma.outboxEvent.deleteMany({ where: { type: { in: ['WorkOrderCreated', 'WorkOrderClosed'] } } }); };
  const dayPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init();
    if ((await prisma.networkDevice.count({ where: { sourceOrder: null } })) < 76) await loadNetwork(prisma);
    const s = await prisma.iotDevice.findFirstOrThrow({ orderBy: { id: 'asc' } });
    sensorId = s.id; sensorName = s.name;
    const d = await prisma.networkDevice.findFirstOrThrow({ where: { sourceOrder: null }, orderBy: { id: 'asc' } }); deviceId = d.id; deviceName = d.name;
  });
  beforeEach(wipe);
  afterAll(async () => { await wipe(); await app.close(); await prisma.$disconnect(); });

  it('roles: only the manager creates, changes and assigns (401/403); the manager and the project lead read; sales and billing do not', async () => {
    const o = (await create()).body;
    expect((await call('post', '/work-orders', undefined, body())).status).toBe(401);
    for (const u of [USERS.lead, USERS.billing, USERS.sales]) {
      expect((await create({}, u)).status).toBe(403);
      expect((await call('patch', `/work-orders/${o.id}/status`, u, { status: 'done' })).status).toBe(403);
      expect((await call('patch', `/work-orders/${o.id}/assign`, u, { assignedTo: 'Ana Gil' })).status).toBe(403);
    }
    for (const u of [M, USERS.lead]) { expect((await call('get', '/work-orders', u)).status).toBe(200); expect((await call('get', `/work-orders/${o.id}`, u)).status).toBe(200); }
    for (const u of [USERS.billing, USERS.sales]) { expect((await call('get', '/work-orders', u)).status).toBe(403); expect((await call('get', `/work-orders/${o.id}`, u)).status).toBe(403); }
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('open');
  });

  it('the client cannot send the equipment name: the extra field is refused (400)', async () => { expect((await create({ targetName: 'Nombre falso' })).status).toBe(400); expect(await prisma.workOrder.count()).toBe(0); });

  it('creates on a sensor and on a network device; the equipment NAME comes from the database, never from the client; the event and the first log line are written', async () => {
    const a = await create({ priority: 'critical', dueDate: dayPlus(5), assignedTo: 'Laura Ríos', sourceNote: 'ALERT 41,2 °C' }); expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ number: expect.stringMatching(/^OT-\d{4}$/), type: 'corrective', status: 'open', priority: 'critical', targetKind: 'sensor', targetRef: sensorId, targetName: sensorName, dueDate: dayPlus(5), assignedTo: 'Laura Ríos', sourceNote: 'ALERT 41,2 °C', createdBy: M.email });
    const b = await create({ type: 'preventive', targetKind: 'device', targetRef: deviceId, description: 'Limpieza y revisión de ventilación' }); expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ targetKind: 'device', targetName: deviceName, priority: 'normal' });
    const ev = await prisma.outboxEvent.findMany({ where: { type: 'WorkOrderCreated' }, orderBy: { createdAt: 'asc' } });
    expect(ev).toHaveLength(2); expect(ev[0]).toMatchObject({ routingKey: 'ops.workorder.created' }); expect((ev[0].payload as any).data).toEqual({ orderNumber: a.body.number, orderType: 'corrective', priority: 'critical', targetKind: 'sensor', targetName: sensorName, dueDate: dayPlus(5) });
    expect(JSON.stringify(ev[0].payload)).not.toContain('Laura'); // sin datos personales en el evento
    expect(await prisma.workOrderLog.count({ where: { orderId: a.body.id, fromStatus: null, toStatus: 'open' } })).toBe(1);
  });

  it.each<[string, object]>([['type unknown', { type: 'repair' }], ['description short', { description: 'ab' }], ['markup', { description: '<script>x</script>' }], ['past due date', { dueDate: dayPlus(-1) }], ['impossible date', { dueDate: '2026-02-30' }],
    ['priority unknown', { priority: 'urgent' }], ['sensor ref with injection', { targetRef: "x'; DROP TABLE work_orders" }], ['device ref text', { targetKind: 'device', targetRef: 'abc' }], ['assignee markup', { assignedTo: '<b>x</b>' }], ['extra field', { extra: 1 }]])('400 and nothing is created: %s', async (_n, over) => {
    expect((await create(over)).status).toBe(400); expect(await prisma.workOrder.count()).toBe(0); expect(await prisma.outboxEvent.count({ where: { type: 'WorkOrderCreated' } })).toBe(0);
  });

  it('unknown equipment is 404 (and nothing is created); a malformed id is 400', async () => {
    expect((await create({ targetRef: 'NO_EXISTE_9' })).status).toBe(404);
    expect((await create({ targetKind: 'device', targetRef: 999999 })).status).toBe(404);
    expect(await prisma.workOrder.count()).toBe(0);
    expect((await call('get', '/work-orders/zz', M)).status).toBe(400); expect((await call('get', `/work-orders/${randomUUID()}`, M)).status).toBe(404);
  });

  it('only ONE open order per equipment and type: the second says which one exists (409); another type or another equipment is fine; after closing it can be opened again', async () => {
    const a = (await create()).body;
    const dup = await create(); expect(dup.status).toBe(409); expect(dup.body.message).toContain(a.number);
    expect((await create({ type: 'inspection' })).status).toBe(201); expect((await create({ targetKind: 'device', targetRef: deviceId })).status).toBe(201);
    await call('patch', `/work-orders/${a.id}/status`, M, { status: 'done' });
    expect((await create()).status).toBe(201);
    expect(await prisma.workOrder.count()).toBe(4);
  });

  it('CONCURRENCY: 20 rounds of 8 simultaneous clicks on "Create" for the same equipment and type → exactly one is created, seven get 409, one event', async () => {
    for (let r = 0; r < 20; r++) {
      await wipe();
      const res = await Promise.all(Array.from({ length: 8 }, () => create()));
      expect(res.filter((x) => x.status === 201)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
      expect(await prisma.workOrder.count()).toBe(1); expect(await prisma.outboxEvent.count({ where: { type: 'WorkOrderCreated' } })).toBe(1);
    }
  }, 120_000);

  it('the status goes open → in_progress → done with the actor and the note in the history; done is final (409); the closing publishes WorkOrderClosed once', async () => {
    const o = (await create()).body;
    const s = (n: string, note?: string) => call('patch', `/work-orders/${o.id}/status`, M, { status: n, ...(note ? { note } : {}) });
    expect((await s('in_progress', 'Técnico en camino')).body).toMatchObject({ status: 'in_progress', closedAt: null });
    expect((await s('open')).status).toBe(409); // no se retrocede
    const done = await s('done', 'Se cambió la fuente'); expect(done.body).toMatchObject({ status: 'done', closedBy: M.email }); expect(done.body.closedAt).toBeTruthy();
    for (const n of ['in_progress', 'done', 'cancelled', 'open']) expect((await s(n)).status).toBe(409);
    const ev = await prisma.outboxEvent.findMany({ where: { type: 'WorkOrderClosed' } }); expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ routingKey: 'ops.workorder.closed' }); expect((ev[0].payload as any).data).toEqual({ orderNumber: o.number, orderType: 'corrective', outcome: 'done', targetName: sensorName });
    const g = (await call('get', `/work-orders/${o.id}`, M)).body;
    expect(g.log.map((l: any) => [l.from, l.to, l.actor, l.note])).toEqual([[null, 'open', M.email, null], ['open', 'in_progress', M.email, 'Técnico en camino'], ['in_progress', 'done', M.email, 'Se cambió la fuente']]);
  });

  it('bad status or note is 400 and changes nothing; cancelling publishes WorkOrderClosed with outcome cancelled', async () => {
    const o = (await create()).body;
    for (const b of [{ status: 'closed' }, { status: '' }, {}, { status: 'done', note: '<b>x</b>' }, { status: 'done', note: 'x'.repeat(301) }]) expect((await call('patch', `/work-orders/${o.id}/status`, M, b)).status).toBe(400);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('open');
    expect((await call('patch', `/work-orders/${o.id}/status`, M, { status: 'cancelled' })).status).toBe(200);
    expect(((await prisma.outboxEvent.findFirstOrThrow({ where: { type: 'WorkOrderClosed' } })).payload as any).data.outcome).toBe('cancelled');
    expect((await call('patch', `/work-orders/${randomUUID()}/status`, M, { status: 'done' })).status).toBe(404);
  });

  it('CONCURRENCY: 30 rounds of closing, cancelling and starting the same order at once → exactly one closes it, the final status matches the winner and one event is published', async () => {
    for (let r = 0; r < 30; r++) {
      await wipe();
      const o = (await create()).body;
      const res = await Promise.all([call('patch', `/work-orders/${o.id}/status`, M, { status: 'done' }), call('patch', `/work-orders/${o.id}/status`, M, { status: 'cancelled' }), call('patch', `/work-orders/${o.id}/status`, M, { status: 'done' }), call('patch', `/work-orders/${o.id}/status`, M, { status: 'in_progress' })]);
      const closers = res.slice(0, 3).filter((x) => x.status === 200); expect(closers).toHaveLength(1);
      const final = await prisma.workOrder.findUniqueOrThrow({ where: { id: o.id } }); expect(final.status).toBe(closers[0].body.status);
      expect(await prisma.outboxEvent.count({ where: { type: 'WorkOrderClosed' } })).toBe(1);
      expect(await prisma.workOrderLog.count({ where: { orderId: o.id, toStatus: { in: ['done', 'cancelled'] } } })).toBe(1);
    }
  }, 180_000);

  it('assigning sets or clears the responsible name while the order is open and is refused once it is closed', async () => {
    const o = (await create()).body;
    expect((await call('patch', `/work-orders/${o.id}/assign`, M, { assignedTo: 'Ana  Gil' })).body.assignedTo).toBe('Ana Gil');
    expect((await call('patch', `/work-orders/${o.id}/assign`, M, { assignedTo: '' })).body.assignedTo).toBeNull();
    expect((await call('patch', `/work-orders/${o.id}/assign`, M, { assignedTo: '<b>x</b>' })).status).toBe(400);
    await call('patch', `/work-orders/${o.id}/status`, M, { status: 'done' });
    expect((await call('patch', `/work-orders/${o.id}/assign`, M, { assignedTo: 'Ana Gil' })).status).toBe(409);
  });

  it('the list puts open orders first, filters by status and validates its parameters', async () => {
    const a = (await create()).body; await create({ type: 'inspection' }); await call('patch', `/work-orders/${a.id}/status`, M, { status: 'done' });
    const all = (await call('get', '/work-orders', M)).body; expect(all.map((x: any) => x.status)).toEqual(['open', 'done']);
    expect((await call('get', '/work-orders?status=done', M)).body).toHaveLength(1);
    for (const q of ['status=weird', 'limit=0', 'limit=201', 'limit=abc']) expect((await call('get', `/work-orders?${q}`, M)).status).toBe(400);
  });

  it('the database refuses impossible rows: a closed order without a date, an unknown type, two open orders for the same equipment and type', async () => {
    const ins = (extra: string) => prisma.$executeRawUnsafe(`INSERT INTO work_orders (type, status, target_kind, target_ref, target_name, description ${extra.split('|')[0]}) VALUES ('corrective', 'open', 'sensor', 'X1', 'n', 'desc' ${extra.split('|')[1] ?? ''})`);
    await prisma.$executeRawUnsafe(`INSERT INTO work_orders (type, status, target_kind, target_ref, target_name, description) VALUES ('corrective', 'open', 'sensor', 'X1', 'n', 'desc')`);
    await expect(ins('')).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO work_orders (type, status, target_kind, target_ref, target_name, description) VALUES ('repair', 'open', 'sensor', 'X2', 'n', 'desc')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO work_orders (type, status, target_kind, target_ref, target_name, description) VALUES ('corrective', 'done', 'sensor', 'X3', 'n', 'desc')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO work_orders (type, status, target_kind, target_ref, target_name, description) VALUES ('inspection', 'open', 'sensor', 'X4', 'n', 'ab')`)).rejects.toThrow();
  });

  it('the responsible can be chosen from the staff list: the id travels with the name, it needs the name, it must be a UUID, and reassigning or clearing keeps both in step', async () => {
    const id1 = randomUUID(), id2 = randomUUID();
    const a = await create({ assignedTo: 'Hugo Salazar', assignedToId: id1.toUpperCase() }); expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ assignedTo: 'Hugo Salazar', assignedToId: id1 }); // el id se guarda en minúsculas
    expect((await call('get', '/work-orders', M)).body.find((x: any) => x.id === a.body.id)).toMatchObject({ assignedToId: id1 });
    for (const bad of [{ assignedToId: 'zz', assignedTo: 'Ana Gil' }, { assignedToId: id1 }, { assignedToId: id1, assignedTo: '' }, { assignedToId: 5, assignedTo: 'Ana Gil' }, { assignedToId: "x'; DROP TABLE work_orders", assignedTo: 'Ana Gil' }]) expect((await create(bad)).status).toBe(400);
    const patch = (b: object) => call('patch', `/work-orders/${a.body.id}/assign`, M, b);
    expect((await patch({ assignedTo: 'Nelly Ortiz', assignedToId: id2 })).body).toMatchObject({ assignedTo: 'Nelly Ortiz', assignedToId: id2 });
    expect((await patch({ assignedTo: 'Ana Gil' })).body).toMatchObject({ assignedTo: 'Ana Gil', assignedToId: null }); // un nombre escrito sin id borra el id viejo
    expect((await patch({ assignedToId: id1 })).status).toBe(400);
    expect((await patch({ assignedTo: '' })).body).toMatchObject({ assignedTo: null, assignedToId: null });
    await expect(prisma.$executeRawUnsafe(`UPDATE work_orders SET assigned_to = NULL, assigned_to_id = '${id1}' WHERE id = '${a.body.id}'`)).rejects.toThrow(); // CHECK en la base
  });
});
