import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { loadNetwork } from '../prisma/network-load';
import { bearer, token, USERS } from './helpers';
import { CapacityStub } from './capacity-stub';

process.env.RATE_LIMIT = '100000';
const stub = new CapacityStub();

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
    process.env.CAPACITY_URL = await stub.start();
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init();
    if ((await prisma.networkDevice.count({ where: { sourceOrder: null } })) < 76) await loadNetwork(prisma);
    const s = await prisma.iotDevice.findFirstOrThrow({ orderBy: { id: 'asc' } });
    sensorId = s.id; sensorName = s.name;
    const d = await prisma.networkDevice.findFirstOrThrow({ where: { sourceOrder: null }, orderBy: { id: 'asc' } }); deviceId = d.id; deviceName = d.name;
  });
  beforeEach(async () => { stub.reset(); await wipe(); });
  afterAll(async () => { await wipe(); await app.close(); await stub.stop(); await prisma.$disconnect(); });

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
    expect(ev[0]).toMatchObject({ routingKey: 'ops.workorder.closed' }); expect((ev[0].payload as any).data).toEqual({ orderId: o.id, orderNumber: o.number, orderType: 'corrective', outcome: 'done', targetName: sensorName });
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
    const CAP = { capacityPercent: 30, capacityStart: dayPlus(1), capacityEnd: dayPlus(5) };
    const a = await create({ assignedTo: 'Hugo Salazar', assignedToId: id1.toUpperCase(), ...CAP }); expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ assignedTo: 'Hugo Salazar', assignedToId: id1 }); // el id se guarda en minúsculas
    expect((await call('get', '/work-orders', M)).body.find((x: any) => x.id === a.body.id)).toMatchObject({ assignedToId: id1 });
    for (const bad of [{ assignedToId: 'zz', assignedTo: 'Ana Gil' }, { assignedToId: id1 }, { assignedToId: id1, assignedTo: '' }, { assignedToId: 5, assignedTo: 'Ana Gil' }, { assignedToId: "x'; DROP TABLE work_orders", assignedTo: 'Ana Gil' }].map((b) => ({ ...CAP, ...b }))) expect((await create(bad)).status).toBe(400);
    const patch = (b: object) => call('patch', `/work-orders/${a.body.id}/assign`, M, b);
    expect((await patch({ assignedTo: 'Nelly Ortiz', assignedToId: id2, ...CAP })).body).toMatchObject({ assignedTo: 'Nelly Ortiz', assignedToId: id2 });
    expect((await patch({ assignedTo: 'Ana Gil' })).body).toMatchObject({ assignedTo: 'Ana Gil', assignedToId: null }); // un nombre escrito sin id borra el id viejo
    expect((await patch({ assignedToId: id1, ...CAP })).status).toBe(400);
    expect((await patch({ assignedTo: '' })).body).toMatchObject({ assignedTo: null, assignedToId: null });
    await expect(prisma.$executeRawUnsafe(`UPDATE work_orders SET assigned_to = NULL, assigned_to_id = '${id1}' WHERE id = '${a.body.id}'`)).rejects.toThrow(); // CHECK en la base
  });

  describe('a work order with a responsible person SPENDS capacity', () => {
    const person = randomUUID();
    const withCap = (o: object = {}) => ({ assignedTo: 'Hugo Salazar', assignedToId: person, capacityPercent: 30, capacityStart: dayPlus(1), capacityEnd: dayPlus(5), ...o });
    const rowOf = (id: string) => prisma.workOrder.findUniqueOrThrow({ where: { id } });
    const events = (type: string) => prisma.outboxEvent.count({ where: { type } });

    it('creating reserves in Technical Capacity with the forwarded token, the order id and a label; the order is reserved and WorkOrderCreated is published only after the reservation', async () => {
      const r = await create(withCap()); expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ capacityState: 'reserved', capacityPercent: 30, capacityStart: dayPlus(1), capacityEnd: dayPlus(5) });
      expect(stub.calls).toHaveLength(1); const c = stub.calls[0];
      expect(c).toMatchObject({ method: 'PUT', orderId: r.body.id, body: { engineerId: person, percent: 30, startDate: dayPlus(1), endDate: dayPlus(5), allowOverallocation: false } });
      expect(c.auth).toBe(as(M)); expect(c.correlation).toBeTruthy(); expect(c.body.label).toBe(`${r.body.number} · ${sensorName}`.slice(0, 80));
      expect(await events('WorkOrderCreated')).toBe(1);
    });

    it('capacityPercent and the dates are REQUIRED with a person from the list, and refused without one; bad values are 400 and nothing is called', async () => {
      const bads = [{ capacityPercent: undefined }, { capacityStart: undefined }, { capacityEnd: undefined }, { capacityPercent: 0 }, { capacityPercent: 101 }, { capacityPercent: 1.5 }, { capacityPercent: '30' },
        { capacityStart: '2026-02-30' }, { capacityStart: 'mañana' }, { capacityEnd: dayPlus(0) }, { capacityEnd: '2101-01-01' }, { capacityStart: '1999-01-01', capacityEnd: '2100-12-31' }, { allowOverallocation: 'si' }];
      for (const b of bads) expect((await create(withCap(b))).status).toBe(400);
      expect((await create({ assignedTo: 'Ana Gil', capacityPercent: 30 })).status).toBe(400); // sin id de la lista no hay reserva
      expect((await create({ capacityStart: dayPlus(1) })).status).toBe(400);
      expect(stub.calls).toHaveLength(0); expect(await prisma.workOrder.count()).toBe(0);
    });

    it('a name without id keeps working as before: no reservation, no call', async () => {
      const r = await create({ assignedTo: 'Ana Gil' }); expect(r.status).toBe(201); expect(r.body).toMatchObject({ capacityState: 'none', capacityPercent: null });
      expect(stub.calls).toHaveLength(0);
    });

    it('Technical Capacity refuses (over 100 %): 409 with ITS message, and nothing is left — no order, no event, no number reused as an open order', async () => {
      stub.mode = 'conflict';
      const r = await create(withCap()); expect(r.status).toBe(409); expect(r.body.message).toMatch(/110%/);
      expect(await prisma.workOrder.count()).toBe(0); expect(await events('WorkOrderCreated')).toBe(0);
      stub.mode = 'ok'; expect((await create(withCap())).status).toBe(201); // el equipo y el tipo quedaron libres: se puede crear la orden de verdad
    });

    it('unknown person (404) and invalid data (400) from Capacity are passed on; nothing is left', async () => {
      stub.mode = 'notfound'; expect((await create(withCap())).status).toBe(404);
      stub.mode = 'invalid'; expect((await create(withCap())).status).toBe(400);
      expect(await prisma.workOrder.count()).toBe(0);
    });

    it('Technical Capacity is down: 502, the order is deleted and a release is attempted in case it saved without answering', async () => {
      stub.mode = 'down'; const r = await create(withCap()); expect(r.status).toBe(502);
      expect(await prisma.workOrder.count()).toBe(0); expect(await events('WorkOrderCreated')).toBe(0);
      expect(stub.calls.map((c) => c.method)).toEqual(['PUT', 'DELETE']); // un 5xx no dice si guardó: se libera por si acaso
    });

    it('Technical Capacity is slow (past the timeout): 502 and the order is deleted', async () => {
      stub.delayMs = 9500; const r = await create(withCap()); expect(r.status).toBe(502); expect(await prisma.workOrder.count()).toBe(0);
      expect(stub.calls.map((c) => c.method)).toEqual(['PUT', 'DELETE']); // sin respuesta no se sabe si guardó: se libera por si acaso
    }, 40_000);

    it('reassigning MOVES the reservation (same order id); a refusal leaves the order exactly as it was', async () => {
      const a = (await create(withCap())).body; const other = randomUUID();
      const moved = await call('patch', `/work-orders/${a.id}/assign`, M, withCap({ assignedTo: 'Nelly Ortiz', assignedToId: other, capacityPercent: 50 }));
      expect(moved.status).toBe(200); expect(moved.body).toMatchObject({ assignedTo: 'Nelly Ortiz', assignedToId: other, capacityPercent: 50, capacityState: 'reserved' });
      expect(stub.reserved.get(a.id)).toMatchObject({ engineerId: other, percent: 50 });
      stub.mode = 'conflict';
      const refused = await call('patch', `/work-orders/${a.id}/assign`, M, withCap({ assignedTo: 'Hugo Salazar', assignedToId: person, capacityPercent: 90 })); expect(refused.status).toBe(409);
      expect(await rowOf(a.id)).toMatchObject({ assignedTo: 'Nelly Ortiz', assignedToId: other, capacityPercent: 50, capacityState: 'reserved' });
    });

    it('a refusal because Capacity did not answer restores the order and puts the old reservation back', async () => {
      const a = (await create(withCap())).body; stub.calls = [];
      stub.mode = 'down'; const r = await call('patch', `/work-orders/${a.id}/assign`, M, withCap({ assignedToId: randomUUID(), assignedTo: 'Nelly Ortiz' })); expect(r.status).toBe(502);
      expect(await rowOf(a.id)).toMatchObject({ assignedToId: person, capacityState: 'reserved', capacityPercent: 30 });
      stub.mode = 'ok';
      expect((await call('patch', `/work-orders/${a.id}/assign`, M, { assignedTo: '' })).body).toMatchObject({ assignedToId: null, capacityState: 'none', capacityPercent: null });
    });

    it('clearing the responsible (or typing a name without id) releases the reservation first; if Capacity cannot release, nothing changes', async () => {
      const a = (await create(withCap())).body; stub.calls = [];
      stub.mode = 'down'; expect((await call('patch', `/work-orders/${a.id}/assign`, M, { assignedTo: '' })).status).toBe(502);
      expect(await rowOf(a.id)).toMatchObject({ assignedToId: person, capacityState: 'reserved' });
      stub.mode = 'ok'; const r = await call('patch', `/work-orders/${a.id}/assign`, M, { assignedTo: 'Ana Gil' });
      expect(r.body).toMatchObject({ assignedTo: 'Ana Gil', assignedToId: null, capacityState: 'none', capacityStart: null }); expect(stub.reserved.has(a.id)).toBe(false);
    });

    it('closing or cancelling publishes WorkOrderClosed with the order id (Capacity frees the reservation from it); a pending order cannot be closed or reassigned', async () => {
      const a = (await create(withCap())).body, b = (await create(withCap({ targetRef: deviceId, targetKind: 'device' }))).body;
      expect((await call('patch', `/work-orders/${a.id}/status`, M, { status: 'done' })).status).toBe(200);
      expect((await call('patch', `/work-orders/${b.id}/status`, M, { status: 'cancelled', note: 'ya no hace falta' })).status).toBe(200);
      const ev = await prisma.outboxEvent.findMany({ where: { type: 'WorkOrderClosed' } });
      expect(ev.map((e) => (e.payload as any).data.orderId).sort()).toEqual([a.id, b.id].sort());
      const c = (await create(withCap({ type: 'preventive' }))).body;
      await prisma.$executeRawUnsafe(`UPDATE work_orders SET capacity_state = 'pending' WHERE id = '${c.id}'`);
      expect((await call('patch', `/work-orders/${c.id}/status`, M, { status: 'done' })).status).toBe(409);
      expect((await call('patch', `/work-orders/${c.id}/assign`, M, withCap())).status).toBe(409);
    });

    it('the database refuses reserved capacity without a person, without percent or dates, or with the end before the start', async () => {
      const a = (await create(withCap())).body;
      for (const sql of [`UPDATE work_orders SET assigned_to_id = NULL, assigned_to = NULL WHERE id = '${a.id}'`, `UPDATE work_orders SET capacity_percent = NULL WHERE id = '${a.id}'`, `UPDATE work_orders SET capacity_percent = 101 WHERE id = '${a.id}'`,
        `UPDATE work_orders SET capacity_end = capacity_start - 1 WHERE id = '${a.id}'`, `UPDATE work_orders SET capacity_state = 'maybe' WHERE id = '${a.id}'`, `UPDATE work_orders SET capacity_state = 'none' WHERE id = '${a.id}'`]) await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
    });

    it('CONCURRENCY: 8 simultaneous reassignments of the same order → every answer is coherent and the order ends with ONE person and a reservation that matches it', async () => {
      for (let r = 0; r < 20; r++) {
        await wipe(); stub.reset();
        const a = (await create(withCap())).body; const people = Array.from({ length: 4 }, () => randomUUID());
        const res = await Promise.all(Array.from({ length: 8 }, (_, k) => call('patch', `/work-orders/${a.id}/assign`, M, withCap({ assignedToId: people[k % 4], assignedTo: `Persona ${k % 4}`, capacityPercent: 10 + k }))));
        for (const x of res) expect([200, 409]).toContain(x.status);
        const row = await rowOf(a.id);
        expect(row.capacityState).toBe('reserved'); expect(stub.reserved.get(a.id)?.engineerId).toBe(row.assignedToId); expect(stub.reserved.get(a.id)?.percent).toBe(row.capacityPercent);
      }
    }, 120_000);

    it('CONCURRENCY: closing and reassigning at the same time never leaves a closed order with a reservation that Capacity will not free', async () => {
      for (let r = 0; r < 20; r++) {
        await wipe(); stub.reset();
        const a = (await create(withCap())).body;
        const res = await Promise.all([call('patch', `/work-orders/${a.id}/status`, M, { status: 'done' }), call('patch', `/work-orders/${a.id}/assign`, M, withCap({ assignedToId: randomUUID(), assignedTo: 'Otra persona' }))]);
        for (const x of res) expect([200, 409]).toContain(x.status);
        const row = await rowOf(a.id);
        // Si la orden quedó cerrada, el aviso de cierre (que libera) existe una sola vez; si no, sigue abierta con su reserva.
        expect(await events('WorkOrderClosed')).toBe(row.status === 'done' ? 1 : 0);
        if (row.status === 'done') expect(row.capacityState).toBe('reserved'); // el cierre lo libera por el aviso, con los datos de la reserva a la vista
      }
    }, 120_000);
  });

  describe('an engineer or a technician sees and moves ONLY their own orders', () => {
    const HUGO = randomUUID(), ANA = randomUUID();
    const tech = { id: randomUUID(), email: 'hugo.salazar@nexus.example', role: 'technician' };
    const eng = { id: randomUUID(), email: 'ana.torres@nexus.example', role: 'engineer' };
    const tok = (u: any, staffId?: string) => bearer(token(u, staffId ? { extra: { staffId } } : {}));
    const callAs = (m: 'get' | 'patch', p: string, auth?: string, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (auth) r = r.set('Authorization', auth); return body ? r.send(body) : r; };
    const assigned = async (staffId: string, name: string, over: object = {}) => (await create({ assignedTo: name, assignedToId: staffId, capacityPercent: 20, capacityStart: dayPlus(1), capacityEnd: dayPlus(3), ...over })).body;
    const closedEvents = () => prisma.outboxEvent.count({ where: { type: 'WorkOrderClosed' } });

    it('GET /work-orders/mine lists only my orders (newest first); the manager and the other roles do not use it (403), no token is 401', async () => {
      const a = await assigned(HUGO, 'Hugo Salazar'); const b = await assigned(ANA, 'Ana Torres', { type: 'preventive' }); const c = await assigned(HUGO, 'Hugo Salazar', { targetKind: 'device', targetRef: deviceId, type: 'inspection' });
      const mine = (await callAs('get', '/work-orders/mine', tok(tech, HUGO))).body; expect(mine.map((o: any) => o.id).sort()).toEqual([a.id, c.id].sort());
      expect((await callAs('get', '/work-orders/mine', tok(eng, ANA))).body.map((o: any) => o.id)).toEqual([b.id]);
      for (const u of [M, USERS.lead, USERS.sales, USERS.billing]) expect((await callAs('get', '/work-orders/mine', tok(u))).status).toBe(403);
      expect((await callAs('get', '/work-orders/mine')).status).toBe(401);
      expect((await callAs('get', '/work-orders', tok(tech, HUGO))).status).toBe(403); // la lista general sigue siendo de gerencia y del líder
      expect((await callAs('get', `/work-orders/${b.id}`, tok(tech, HUGO))).status).toBe(403);
      expect((await callAs('get', '/work-orders/mine', tok(tech, randomUUID()))).body).toEqual([]);
    });

    it('a staff token without the person it belongs to, or a person on another role, is not a valid token (401)', async () => {
      expect((await callAs('get', '/work-orders/mine', tok(tech))).status).toBe(401);
      expect((await callAs('get', '/work-orders/mine', tok(USERS.sales, HUGO))).status).toBe(401);
      expect((await callAs('get', '/work-orders/mine', tok(tech, 'not-a-uuid'))).status).toBe(401);
    });

    it('I can start and finish my order (with a note); finishing publishes WorkOrderClosed once; a closed order is final (409)', async () => {
      const o = await assigned(HUGO, 'Hugo Salazar');
      const r1 = await callAs('patch', `/work-orders/${o.id}/progress`, tok(tech, HUGO), { status: 'in_progress' }); expect(r1.status).toBe(200); expect(r1.body.status).toBe('in_progress');
      const r2 = await callAs('patch', `/work-orders/${o.id}/progress`, tok(tech, HUGO), { status: 'done', note: 'Cambié la fuente' }); expect(r2.status).toBe(200); expect(r2.body).toMatchObject({ status: 'done', closedBy: tech.email });
      expect(await closedEvents()).toBe(1);
      expect((await callAs('patch', `/work-orders/${o.id}/progress`, tok(tech, HUGO), { status: 'done' })).status).toBe(409);
      const g = (await call('get', `/work-orders/${o.id}`, M)).body; expect(g.log.map((l: any) => [l.to, l.actor, l.note])).toEqual([['open', M.email, null], ['in_progress', tech.email, null], ['done', tech.email, 'Cambié la fuente']]);
    });

    it('another person’s order answers 404 (as if it did not exist) and stays untouched; spoofing the person with a header or the body changes nothing', async () => {
      const o = await assigned(ANA, 'Ana Torres');
      for (const extra of [{}, { staffId: ANA }, { assignedToId: ANA }]) {
        const r = await (request(app.getHttpServer()) as any).patch(`/work-orders/${o.id}/progress`).set('Authorization', tok(tech, HUGO)).set('x-staff-id', ANA).send({ status: 'done', ...extra });
        expect([400, 404]).toContain(r.status);
      }
      expect((await callAs('patch', `/work-orders/${randomUUID()}/progress`, tok(tech, HUGO), { status: 'done' })).status).toBe(404);
      expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('open'); expect(await closedEvents()).toBe(0);
    });

    it('only start or finish (400 for cancelling or anything else); the manager and the other roles cannot use this route (403)', async () => {
      const o = await assigned(HUGO, 'Hugo Salazar');
      for (const bad of [{ status: 'cancelled' }, { status: 'open' }, { status: 'x' }, {}, { status: 'done', note: '<b>x</b>' }]) expect((await callAs('patch', `/work-orders/${o.id}/progress`, tok(tech, HUGO), bad)).status).toBe(400);
      for (const u of [M, USERS.lead, USERS.sales, USERS.billing]) expect((await callAs('patch', `/work-orders/${o.id}/progress`, tok(u), { status: 'done' })).status).toBe(403);
      expect((await callAs('patch', `/work-orders/${o.id}/progress`, undefined, { status: 'done' })).status).toBe(401);
      expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('open');
    });

    it('CONCURRENCY: finishing my order while the manager reassigns it → nobody finishes an order that is no longer theirs, and it never closes twice', async () => {
      for (let r = 0; r < 20; r++) {
        await wipe(); stub.reset();
        const o = await assigned(HUGO, 'Hugo Salazar');
        const res = await Promise.all([callAs('patch', `/work-orders/${o.id}/progress`, tok(tech, HUGO), { status: 'done' }), callAs('patch', `/work-orders/${o.id}/assign`, tok(M), { assignedTo: 'Ana Torres', assignedToId: ANA, capacityPercent: 20, capacityStart: dayPlus(1), capacityEnd: dayPlus(3) }), callAs('patch', `/work-orders/${o.id}/progress`, tok(tech, HUGO), { status: 'done' })]);
        for (const x of res) expect([200, 404, 409]).toContain(x.status);
        const row = await prisma.workOrder.findUniqueOrThrow({ where: { id: o.id } });
        if (row.status === 'done') { expect(row.closedBy).toBe(tech.email); expect(row.assignedToId).toBe(HUGO); expect(await closedEvents()).toBe(1); }
        else { expect(row.assignedToId).toBe(ANA); expect(await closedEvents()).toBe(0); }
      }
    }, 120_000);

    it('CONCURRENCY: 8 simultaneous «done» on my order → one succeeds, one WorkOrderClosed', async () => {
      for (let r = 0; r < 15; r++) {
        await wipe(); stub.reset();
        const o = await assigned(HUGO, 'Hugo Salazar');
        const res = await Promise.all(Array.from({ length: 8 }, () => callAs('patch', `/work-orders/${o.id}/progress`, tok(tech, HUGO), { status: 'done' })));
        expect(res.filter((x) => x.status === 200)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7); expect(await closedEvents()).toBe(1);
      }
    }, 120_000);
  });
});
