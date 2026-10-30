import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.RELAY_ENABLED = 'false';
process.env.CONSUMER_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

describe('work orders spend capacity: maintenance allocations (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const M = USERS.manager;
  const call = (m: 'get' | 'post' | 'put' | 'delete', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', bearer(token(who))); return body ? r.send(body) : r; };
  const person = async (name = 'Hugo Prueba', position = 'field_technician') => (await call('post', '/engineers', M, { name, position })).body.id as string;
  const project = (id: string, percent: number, s = '2026-11-02', e = '2026-11-13') => call('post', `/engineers/${id}/allocations`, M, { projectName: 'Branch network upgrade', percent, startDate: s, endDate: e });
  const reserve = (order: string, engineerId: string, percent: number, extra: object = {}, who: any = M) => call('put', `/maintenance/${order}`, who, { engineerId, label: `OT-0007 · Switch piso 2`, percent, startDate: '2026-11-02', endDate: '2026-11-13', ...extra });
  const rows = (engineerId?: string) => prisma.allocation.findMany({ where: { kind: 'maintenance', ...(engineerId ? { engineerId } : {}) } });
  const load = async (id: string) => { const e = (await call('get', '/engineers', M)).body.engineers.find((x: any) => x.id === id); return e.allocations as any[]; };

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  it('only the manager (service to service with the forwarded token): 401 without token, 403 for the other roles', async () => {
    const id = await person(); const o = randomUUID();
    expect((await call('put', `/maintenance/${o}`, undefined, { engineerId: id, label: 'OT-0001 · x', percent: 20, startDate: '2026-11-02', endDate: '2026-11-03' })).status).toBe(401);
    for (const u of [USERS.lead, USERS.sales, USERS.billing]) { expect((await reserve(o, id, 20, {}, u)).status).toBe(403); expect((await call('delete', `/maintenance/${o}`, u)).status).toBe(403); }
    expect(await rows()).toHaveLength(0);
  });

  it('reserving creates ONE maintenance allocation that counts in the load; repeating it changes nothing; it is not a project (no EngineerAllocated, no team, no cost)', async () => {
    const id = await person(); const o = randomUUID();
    const r = await reserve(o, id, 35); expect(r.status).toBe(200); expect(r.body).toMatchObject({ peak: 35, overAllocated: false });
    expect((await reserve(o, id, 35)).body.allocationId).toBe(r.body.allocationId);
    expect(await rows()).toHaveLength(1);
    const a = (await load(id))[0]; expect(a).toMatchObject({ kind: 'maintenance', projectName: 'OT-0007 · Switch piso 2', percent: 35, startDate: '2026-11-02', endDate: '2026-11-13' });
    expect(await prisma.outboxEvent.count({ where: { type: { in: ['EngineerAllocated', 'AllocationRemoved'] } } })).toBe(0);
  });

  it('the 100 % rule is shared with the projects: a project that fills the person refuses a work order (409 with the peak), and the other way round; nothing is stored by a refusal', async () => {
    const id = await person();
    expect((await project(id, 80)).status).toBe(201);
    const o = randomUUID(); const r = await reserve(o, id, 30); expect(r.status).toBe(409); expect(r.body.message).toMatch(/110%/);
    expect(await rows()).toHaveLength(0);
    expect((await reserve(o, id, 20)).status).toBe(200);
    expect((await project(id, 10, '2026-11-02', '2026-11-05')).status).toBe(409); // 80 + 20 + 10 = 110 en esos días → se rechaza
    expect((await project(id, 10, '2026-11-20', '2026-11-25')).status).toBe(201); // fuera de las fechas de la orden sí cabe
  });

  it('the project is refused when maintenance already fills the days (the other direction)', async () => {
    const id = await person();
    expect((await reserve(randomUUID(), id, 70)).status).toBe(200);
    const r = await project(id, 40); expect(r.status).toBe(409); expect(r.body.message).toMatch(/110%/);
    expect(await prisma.allocation.count({ where: { engineerId: id, kind: 'project' } })).toBe(0);
  });

  it('only the manager may go over 100 % on purpose: it is allowed, flagged and announced (OverAllocationDetected)', async () => {
    const id = await person(); await project(id, 90);
    const o = randomUUID(); const r = await reserve(o, id, 30, { allowOverallocation: true });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ peak: 120, overAllocated: true });
    expect((await prisma.allocation.findFirstOrThrow({ where: { workOrderId: o } })).overAllocated).toBe(true);
    const ev = await prisma.outboxEvent.findMany({ where: { type: 'OverAllocationDetected' } }); expect(ev).toHaveLength(1); expect((ev[0].payload as any).data.allocationPercent).toBe(120);
    expect((await reserve(o, id, 30, { allowOverallocation: true })).status).toBe(200); // repetir no duplica el aviso
    expect(await prisma.outboxEvent.count({ where: { type: 'OverAllocationDetected' } })).toBe(1);
  });

  it('changing the person MOVES the allocation: the old one frees up, the new one is checked; a refused move leaves it where it was', async () => {
    const a = await person('Persona A'), b = await person('Persona B'), o = randomUUID();
    const first = await reserve(o, a, 40); expect(first.status).toBe(200);
    expect((await project(b, 90)).status).toBe(201);
    expect((await reserve(o, b, 40)).status).toBe(409);
    expect((await rows(a))).toHaveLength(1); expect((await rows(b))).toHaveLength(0);
    const c = await person('Persona C'); const moved = await reserve(o, c, 25);
    expect(moved.body.allocationId).toBe(first.body.allocationId); // la misma asignación, otra persona
    expect(await rows()).toHaveLength(1); expect((await rows(c))[0].percent).toBe(25); expect(await rows(a)).toHaveLength(0);
  });

  it('changing the percent or the dates of the same order does not count the old values twice (50 project + 40 order → the order can go to 45 and repeat itself)', async () => {
    const id = await person(); const o = randomUUID(); await project(id, 50);
    expect((await reserve(o, id, 40)).status).toBe(200);
    expect((await reserve(o, id, 40)).status).toBe(200); expect((await reserve(o, id, 45)).body.peak).toBe(95); expect((await reserve(o, id, 51)).status).toBe(409);
    expect((await rows(id))[0].percent).toBe(45); // el rechazo no cambió nada
  });

  it('refuses bad input with 400 / 404 and stores nothing', async () => {
    const id = await person(); const o = randomUUID();
    const bads: object[] = [{ percent: 0 }, { percent: 101 }, { percent: 1.5 }, { percent: '20' }, { startDate: '2026-02-30' }, { startDate: 'mañana' }, { endDate: '2026-11-01' }, { endDate: '2030-11-02' }, { label: 'x' }, { label: '<b>OT</b>' }, { label: 5 }, { engineerId: 'zz' }, { extra: 1 }, { allowOverallocation: 'yes' }];
    for (const b of bads) expect((await reserve(o, id, 20, b)).status).toBe(400);
    expect((await reserve(o, randomUUID(), 20)).status).toBe(404);
    expect((await call('put', '/maintenance/not-a-uuid', M, { engineerId: id, label: 'OT-0001 · x', percent: 20, startDate: '2026-11-02', endDate: '2026-11-03' })).status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it('releasing frees the days, is idempotent (a second release is not an error) and does not touch other orders or projects', async () => {
    const id = await person(); const o1 = randomUUID(), o2 = randomUUID(); await project(id, 10);
    await reserve(o1, id, 30); await reserve(o2, id, 30);
    expect((await call('delete', `/maintenance/${o1}`, M)).status).toBe(204); expect((await call('delete', `/maintenance/${o1}`, M)).status).toBe(204);
    expect((await call('delete', `/maintenance/${randomUUID()}`, M)).status).toBe(204);
    expect((await rows()).map((x) => x.workOrderId)).toEqual([o2]); expect(await prisma.allocation.count({ where: { kind: 'project', engineerId: id } })).toBe(1);
    expect((await reserve(randomUUID(), id, 60)).status).toBe(200); // 10 + 30 + 60 = 100: cabe porque el cupo de o1 se liberó
  });

  it('a maintenance allocation cannot be deleted by hand: the order has to be closed or cancelled (409, it stays)', async () => {
    const id = await person(); const o = randomUUID(); const r = await reserve(o, id, 20);
    for (const u of [M, USERS.lead]) { const d = await call('delete', `/allocations/${r.body.allocationId}`, u); expect(d.status).toBe(409); expect(d.body.message).toMatch(/work order/); }
    expect(await rows()).toHaveLength(1);
  });

  it('the database refuses a maintenance allocation without an order, a project one with an order, two for the same order, and an unknown kind', async () => {
    const id = await person(); const o = randomUUID();
    const ins = (kind: string, wo: string | null) => prisma.$executeRawUnsafe(`INSERT INTO allocations (engineer_id, project_name, percent, start_date, end_date, kind, work_order_id) VALUES ('${id}', 'X ok', 10, '2026-11-02', '2026-11-03', '${kind}', ${wo ? `'${wo}'` : 'NULL'})`);
    await expect(ins('maintenance', null)).rejects.toThrow(); await expect(ins('project', o)).rejects.toThrow(); await expect(ins('other', null)).rejects.toThrow();
    await ins('maintenance', o); await expect(ins('maintenance', o)).rejects.toThrow();
  });

  it('CONCURRENCY: 30 rounds of 8 work orders at 30 % on the same person at once → exactly 3 fit (90 %), the other 5 are refused, nobody passes 100 %', async () => {
    for (let r = 0; r < 30; r++) {
      await resetState(prisma); const id = await person();
      const res = await Promise.all(Array.from({ length: 8 }, () => reserve(randomUUID(), id, 30)));
      expect(res.filter((x) => x.status === 200)).toHaveLength(3); expect(res.filter((x) => x.status === 409)).toHaveLength(5); expect(res.filter((x) => ![200, 409].includes(x.status))).toHaveLength(0);
      expect(await rows(id)).toHaveLength(3);
    }
  }, 240_000);

  it('CONCURRENCY: work orders and project allocations competing for the same person at once → the invariant «never over 100 %» holds in every round', async () => {
    for (let r = 0; r < 30; r++) {
      await resetState(prisma); const id = await person();
      const res = await Promise.all([reserve(randomUUID(), id, 60), reserve(randomUUID(), id, 60), project(id, 60), project(id, 60), reserve(randomUUID(), id, 40), project(id, 40)]);
      for (const x of res) expect([200, 201, 409]).toContain(x.status);
      const all = await prisma.allocation.findMany({ where: { engineerId: id } });
      expect(all.reduce((s, a) => s + a.percent, 0)).toBeLessThanOrEqual(100); // mismas fechas para todas: la suma no pasa de 100
    }
  }, 240_000);

  it('CONCURRENCY: the same order reserved for two different people at once → one allocation, no deadlock, no 500', async () => {
    for (let r = 0; r < 30; r++) {
      await resetState(prisma); const a = await person('Uno'), b = await person('Dos'), o = randomUUID();
      const res = await Promise.all([reserve(o, a, 30), reserve(o, b, 30), reserve(o, a, 30), reserve(o, b, 30)]);
      for (const x of res) expect([200]).toContain(x.status);
      expect(await prisma.allocation.count({ where: { workOrderId: o } })).toBe(1);
    }
  }, 240_000);

  it('CONCURRENCY: two orders swapping people at once (A→B and B→A) never deadlock and each order keeps exactly one allocation', async () => {
    for (let r = 0; r < 30; r++) {
      await resetState(prisma); const a = await person('Uno'), b = await person('Dos'), o1 = randomUUID(), o2 = randomUUID();
      await reserve(o1, a, 40); await reserve(o2, b, 40);
      const res = await Promise.all([reserve(o1, b, 40), reserve(o2, a, 40), reserve(o1, a, 40), reserve(o2, b, 40)]);
      for (const x of res) expect([200, 409]).toContain(x.status);
      expect(await prisma.allocation.count({ where: { workOrderId: o1 } })).toBe(1); expect(await prisma.allocation.count({ where: { workOrderId: o2 } })).toBe(1);
      for (const id of [a, b]) expect((await rows(id)).reduce((s, x) => s + x.percent, 0)).toBeLessThanOrEqual(100);
    }
  }, 240_000);
});
