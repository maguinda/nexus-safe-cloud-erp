import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.RATE_LIMIT = '100000';

const E1 = '11111111-1111-4111-8111-111111111101'; // Ana (ingeniera)
const E2 = '11111111-1111-4111-8111-111111111102'; // Julián (ingeniero)
const T1 = '11111111-1111-4111-8111-111111111107'; // Hugo (técnico)
const T2 = '11111111-1111-4111-8111-111111111108'; // Nelly (técnica)
const ENG1 = { id: randomUUID(), email: 'ana.torres@nexus.example', role: 'engineer', staffId: E1 };
const ENG2 = { id: randomUUID(), email: 'julian.pardo@nexus.example', role: 'engineer', staffId: E2 };
const TECH1 = { id: randomUUID(), email: 'hugo.salazar@nexus.example', role: 'technician', staffId: T1 };
const TECH2 = { id: randomUUID(), email: 'nelly.ortiz@nexus.example', role: 'technician', staffId: T2 };
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

describe('milestone owner and activities (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const tok = (u: any) => bearer(token(u, u.staffId ? { extra: { staffId: u.staffId } } : {}));
  const call = (m: 'get' | 'post' | 'patch', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', tok(who)); return body ? r.send(body) : r; };
  const owner = (ms: string, who: any, ownerId: string | null, ownerName = 'Ana Torres') => call('patch', `/milestones/${ms}/owner`, who, ownerId === null ? { ownerId: null } : { ownerId, ownerName });
  const act = (ms: string, who: any, over: object = {}) => call('post', `/milestones/${ms}/activities`, who, { title: 'Instalar el switch', assignedToId: T1, assignedTo: 'Hugo Salazar', ...over });
  const prog = (id: string, who: any, status: string, note?: string) => call('patch', `/activities/${id}/progress`, who, { status, ...(note ? { note } : {}) });
  const row = (id: string) => prisma.milestoneActivity.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('who chooses the engineer in charge of a milestone', () => {
    it('manager and project lead choose, change and clear it; everyone else gets 403 and nothing changes', async () => {
      expect((await owner('m2', USERS.lead, E1)).status).toBe(200);
      expect((await prisma.milestone.findUniqueOrThrow({ where: { id: 'm2' } })).ownerId).toBe(E1);
      expect((await owner('m2', USERS.manager, E2, 'Julián Pardo')).body).toEqual({ milestoneId: 'm2', ownerId: E2, ownerName: 'Julián Pardo' });
      for (const who of [USERS.sales, USERS.billing, ENG1, ENG2, TECH1]) expect((await owner('m2', who, E1)).status).toBe(403);
      expect((await prisma.milestone.findUniqueOrThrow({ where: { id: 'm2' } })).ownerId).toBe(E2);
      expect((await owner('m2', USERS.lead, null)).body).toEqual({ milestoneId: 'm2', ownerId: null, ownerName: null });
      expect((await call('patch', '/milestones/m2/owner')).status).toBe(401);
    });
    it('bad input: unknown milestone 404, bad id or missing name 400, extra fields 400, an approved milestone 409', async () => {
      expect((await owner('m-nope', USERS.lead, E1)).status).toBe(404);
      expect((await owner('m2', USERS.lead, 'no-uuid')).status).toBe(400);
      expect((await call('patch', '/milestones/m2/owner', USERS.lead, { ownerId: E1 })).status).toBe(400);
      expect((await call('patch', '/milestones/m2/owner', USERS.lead, { ownerId: E1, ownerName: 'Ana Torres', amountCop: 1 })).status).toBe(400);
      expect((await owner('m1', USERS.lead, E1)).status).toBe(409); // m1 ya está aprobado
    });
  });

  describe('what each person sees', () => {
    it('an engineer sees only the milestones they are in charge of, with the project and no money; the others use other routes (403)', async () => {
      await owner('m2', USERS.lead, E1); await owner('m3', USERS.lead, E2, 'Julián Pardo');
      const a = await call('get', '/my-milestones', ENG1);
      expect(a.status).toBe(200); expect(a.body.map((m: any) => m.milestoneId)).toEqual(['m2']);
      expect(a.body[0]).toMatchObject({ milestoneId: 'm2', status: 'pending', projectName: expect.any(String), progress: { total: 0, done: 0, pct: 0 } });
      expect(JSON.stringify(a.body)).not.toMatch(/amountCop|amount/i);
      expect((await call('get', '/my-milestones', ENG2)).body.map((m: any) => m.milestoneId)).toEqual(['m3']);
      for (const who of [USERS.lead, USERS.manager, USERS.sales, TECH1]) expect((await call('get', '/my-milestones', who)).status).toBe(403);
      expect((await call('get', '/my-milestones')).status).toBe(401);
    });
    it('a technician sees only what is assigned to them; another technician sees nothing', async () => {
      await owner('m2', USERS.lead, E1);
      await act('m2', ENG1, { title: 'Para Hugo' }); await act('m2', ENG1, { title: 'Para Nelly', assignedToId: T2, assignedTo: 'Nelly Ortiz' });
      const h = await call('get', '/my-activities', TECH1);
      expect(h.body.map((x: any) => x.title)).toEqual(['Para Hugo']);
      expect(h.body[0]).toMatchObject({ code: expect.stringMatching(/^A-\d{4}$/), milestoneName: expect.any(String), projectName: expect.any(String), status: 'open' });
      expect((await call('get', '/my-activities', TECH2)).body.map((x: any) => x.title)).toEqual(['Para Nelly']);
      for (const who of [ENG1, USERS.lead, USERS.manager]) expect((await call('get', '/my-activities', who)).status).toBe(403);
    });
    it('the activities of a milestone: manager and project lead see all, the owner engineer sees theirs, another engineer gets 404', async () => {
      await owner('m2', USERS.lead, E1); await act('m2', ENG1);
      for (const who of [USERS.lead, USERS.manager, ENG1]) expect((await call('get', '/milestones/m2/activities', who)).body).toHaveLength(1);
      expect((await call('get', '/milestones/m2/activities', ENG2)).status).toBe(404);
      for (const who of [TECH1, USERS.sales, USERS.billing]) expect((await call('get', '/milestones/m2/activities', who)).status).toBe(403);
      expect((await call('get', '/milestones/m-nope/activities', USERS.lead)).status).toBe(404);
    });
  });

  describe('creating and changing activities', () => {
    it('the owner engineer creates; another engineer gets 404; manager and project lead can on any; a technician gets 403', async () => {
      await owner('m2', USERS.lead, E1);
      const ok = await act('m2', ENG1, { description: 'Con cable nuevo', dueDate: tomorrow() });
      expect(ok.status).toBe(201); expect(ok.body).toMatchObject({ status: 'open', assignedToId: T1, assignedTo: 'Hugo Salazar', description: 'Con cable nuevo', createdBy: ENG1.email, dueDate: tomorrow() });
      expect((await act('m2', ENG2)).status).toBe(404);
      expect((await act('m2', USERS.lead)).status).toBe(201); expect((await act('m2', USERS.manager)).status).toBe(201);
      for (const who of [TECH1, USERS.sales, USERS.billing]) expect((await act('m2', who)).status).toBe(403);
      expect(await prisma.milestoneActivity.count()).toBe(3);
    });
    it('a milestone with no owner: the engineer cannot create (404), the project lead can; an approved milestone takes no more activities (409)', async () => {
      expect((await act('m2', ENG1)).status).toBe(404);
      expect((await act('m2', USERS.lead)).status).toBe(201);
      expect((await act('m1', USERS.lead)).status).toBe(409);
    });
    it('invalid input is 400 and creates nothing', async () => {
      await owner('m2', USERS.lead, E1);
      for (const over of [{ title: 'ab' }, { title: '   ' }, { title: 'x'.repeat(121) }, { assignedToId: 'no-uuid' }, { assignedTo: 'H' }, { dueDate: '2020-01-01' }, { dueDate: '2026-02-31' }, { description: '<b>x</b>' }, { description: 'x'.repeat(301) }, { status: 'done' }, { id: randomUUID() }, { createdBy: 'x@y.co' }]) {
        expect((await act('m2', ENG1, over)).status).toBe(400);
      }
      expect(await prisma.milestoneActivity.count()).toBe(0);
    });
    it('edit and reassign: the owner changes only what they send; the new technician sees it and the old one no longer does', async () => {
      await owner('m2', USERS.lead, E1);
      const id = (await act('m2', ENG1)).body.id;
      expect((await call('patch', `/activities/${id}`, ENG1, { title: 'Instalar y probar el switch' })).body).toMatchObject({ title: 'Instalar y probar el switch', assignedToId: T1 });
      expect((await call('patch', `/activities/${id}`, ENG1, { assignedToId: T2, assignedTo: 'Nelly Ortiz' })).body).toMatchObject({ assignedToId: T2, title: 'Instalar y probar el switch' });
      expect((await call('get', '/my-activities', TECH1)).body).toHaveLength(0);
      expect((await call('get', '/my-activities', TECH2)).body).toHaveLength(1);
      expect((await prog(id, TECH1, 'done')).status).toBe(404); // el técnico anterior ya no puede tocarla
      expect((await call('patch', `/activities/${id}`, ENG1, {})).status).toBe(400);
      expect((await call('patch', `/activities/${id}`, ENG1, { assignedToId: T1 })).status).toBe(400); // reasignar pide también el nombre
      expect((await call('patch', `/activities/${id}`, ENG1, { dueDate: null })).body.dueDate).toBeNull();
    });
    it('another engineer, a technician and a stranger cannot edit or cancel; an unknown activity is 404', async () => {
      await owner('m2', USERS.lead, E1);
      const id = (await act('m2', ENG1)).body.id;
      expect((await call('patch', `/activities/${id}`, ENG2, { title: 'Robada' })).status).toBe(404);
      expect((await call('post', `/activities/${id}/cancel`, ENG2)).status).toBe(404);
      for (const who of [TECH1, USERS.sales, USERS.billing]) { expect((await call('patch', `/activities/${id}`, who, { title: 'Robada' })).status).toBe(403); expect((await call('post', `/activities/${id}/cancel`, who)).status).toBe(403); }
      expect((await call('patch', `/activities/${randomUUID()}`, ENG1, { title: 'Nada' })).status).toBe(404);
      expect((await call('patch', '/activities/no-uuid', ENG1, { title: 'Nada' })).status).toBe(400);
      expect((await row(id)).title).toBe('Instalar el switch');
    });
    it('cancel: the owner, the manager and the lead can; a cancelled or finished activity does not change any more and a cancelled one cannot be progressed', async () => {
      await owner('m2', USERS.lead, E1);
      const a = (await act('m2', ENG1)).body.id; const b = (await act('m2', ENG1)).body.id;
      expect((await call('post', `/activities/${a}/cancel`, ENG1)).body.status).toBe('cancelled');
      expect((await call('post', `/activities/${a}/cancel`, ENG1)).status).toBe(409);
      expect((await call('patch', `/activities/${a}`, ENG1, { title: 'Otra vez' })).status).toBe(409);
      expect((await prog(a, TECH1, 'done')).status).toBe(409);
      expect((await prog(b, TECH1, 'done')).status).toBe(200);
      expect((await call('post', `/activities/${b}/cancel`, USERS.manager)).status).toBe(409);
      expect((await call('patch', `/activities/${b}`, USERS.lead, { title: 'Otra vez' })).status).toBe(409);
    });
  });

  describe('the technician completes the activity', () => {
    it('start, then finish with a note; every other path is refused with the right code', async () => {
      await owner('m2', USERS.lead, E1);
      const id = (await act('m2', ENG1)).body.id;
      expect((await prog(id, TECH2, 'done')).status).toBe(404); // ajena
      for (const who of [ENG1, USERS.lead, USERS.manager, USERS.sales]) expect((await prog(id, who, 'done')).status).toBe(403);
      expect((await prog(id, TECH1, 'in_progress', 'nota')).status).toBe(400); // una nota solo al terminar
      expect((await prog(id, TECH1, 'done', 'a<b')).status).toBe(400);
      expect((await prog(id, TECH1, 'cancelled')).status).toBe(400);
      expect((await prog(id, TECH1, 'in_progress')).body).toMatchObject({ status: 'in_progress', startedAt: expect.any(String) });
      expect((await prog(id, TECH1, 'in_progress')).status).toBe(409);
      const d = await prog(id, TECH1, 'done', 'Listo y probado');
      expect(d.body).toMatchObject({ status: 'done', doneBy: TECH1.email, doneNote: 'Listo y probado', doneAt: expect.any(String) });
      expect((await prog(id, TECH1, 'done')).status).toBe(409);
      expect((await prog(id, TECH1, 'in_progress')).status).toBe(409);
      expect((await prog(randomUUID(), TECH1, 'done')).status).toBe(404);
    });
    it('finishing straight from «open» is allowed and also records when it started; the milestone progress follows (cancelled ones do not count)', async () => {
      await owner('m2', USERS.lead, E1);
      const a = (await act('m2', ENG1)).body.id; const b = (await act('m2', ENG1)).body.id; const c = (await act('m2', ENG1)).body.id; const d = (await act('m2', ENG1)).body.id;
      await prog(a, TECH1, 'done'); await prog(b, TECH1, 'in_progress'); await call('post', `/activities/${d}/cancel`, ENG1);
      expect((await row(a)).startedAt).not.toBeNull();
      const mine = (await call('get', '/my-milestones', ENG1)).body[0];
      expect(mine.progress).toEqual({ total: 3, done: 1, inProgress: 1, open: 1, pct: 33 });
      expect(c).toBeDefined();
      const p = await call('get', '/projects/p1/milestone-progress', USERS.lead); // m2 es del proyecto p1 en el seed
      expect(p.status).toBe(200);
      expect(p.body.find((x: any) => x.milestoneId === 'm2')).toMatchObject({ ownerId: E1, ownerName: 'Ana Torres', progress: { total: 3, done: 1 } });
      expect((await call('get', '/projects/p1/milestone-progress', USERS.manager)).status).toBe(200);
      for (const who of [ENG1, TECH1, USERS.sales, USERS.billing]) expect((await call('get', '/projects/p1/milestone-progress', who)).status).toBe(403);
      expect((await call('get', '/projects/p-nope/milestone-progress', USERS.lead)).status).toBe(404);
    });
    it('the database itself refuses an inconsistent row (done without who/when, a note on a live activity, bad status)', async () => {
      await owner('m2', USERS.lead, E1);
      const id = (await act('m2', ENG1)).body.id;
      await expect(prisma.$executeRaw`UPDATE milestone_activities SET status = 'done' WHERE id = ${id}::uuid`).rejects.toThrow();
      await expect(prisma.$executeRaw`UPDATE milestone_activities SET done_note = 'x' WHERE id = ${id}::uuid`).rejects.toThrow();
      await expect(prisma.$executeRaw`UPDATE milestone_activities SET status = 'weird' WHERE id = ${id}::uuid`).rejects.toThrow();
      await expect(prisma.$executeRaw`UPDATE milestones SET owner_id = ${E1}::uuid WHERE id = 'm3'`).rejects.toThrow(); // dueño sin nombre
    });
  });

  describe('races', () => {
    it('30 rounds: 8 «finish» clicks at once on the same activity end with exactly one 200, seven 409 and one finishing record', async () => {
      await owner('m2', USERS.lead, E1);
      for (let i = 0; i < 30; i++) {
        const id = (await act('m2', ENG1, { title: `Ronda ${i}` })).body.id;
        const rs = await Promise.all([...Array(8)].map(() => prog(id, TECH1, 'done', 'listo')));
        expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
        expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
        const r = await row(id); expect(r.status).toBe('done'); expect(r.doneBy).toBe(TECH1.email);
      }
    });
    it('20 rounds: reassigning while the old technician finishes never leaves a finished activity changed hands (done wins, or the reassignment wins and the old technician gets 404)', async () => {
      await owner('m2', USERS.lead, E1);
      const outcomes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const id = (await act('m2', ENG1, { title: `Carrera ${i}` })).body.id;
        const [p, e] = await Promise.all([prog(id, TECH1, 'done'), call('patch', `/activities/${id}`, ENG1, { assignedToId: T2, assignedTo: 'Nelly Ortiz' })]);
        expect([p.status, e.status].every((c) => c !== 500)).toBe(true);
        const r = await row(id);
        if (r.status === 'done') { expect(r.assignedToId).toBe(T1); expect(e.status).toBe(409); outcomes.add('done-first'); }
        else { expect(r.assignedToId).toBe(T2); expect(p.status).toBe(404); expect(e.status).toBe(200); outcomes.add('reassign-first'); }
      }
      expect(outcomes.size).toBeGreaterThan(0);
    });
    it('15 rounds: the owner changes while the old owner creates; no 500, and only the current owner can create afterwards', async () => {
      for (let i = 0; i < 15; i++) {
        await owner('m3', USERS.lead, E1);
        const [c] = await Promise.all([act('m3', ENG1, { title: `Antes o después ${i}` }), owner('m3', USERS.manager, E2, 'Julián Pardo')]);
        expect([201, 404]).toContain(c.status);
        expect((await act('m3', ENG1)).status).toBe(404); // ya no es su hito
        expect((await act('m3', ENG2)).status).toBe(201);
      }
    });
    it('20 rounds: creating while the lead approves the milestone: one approval, no 500, and an activity either got in before or got a 409', async () => {
      for (let i = 0; i < 20; i++) {
        await resetState(prisma);
        await owner('m2', USERS.lead, E1);
        const [c, a] = await Promise.all([act('m2', ENG1), call('post', '/milestones/m2/approve', USERS.lead)]);
        expect(a.status).toBe(200); expect([201, 409]).toContain(c.status);
        expect((await act('m2', ENG1)).status).toBe(409); // aprobado: ya no recibe actividades
        expect(await prisma.milestoneActivity.count()).toBe(c.status === 201 ? 1 : 0);
      }
    });
    it('deterministic: while an approval (or an owner change) is in flight holding the milestone lock, a creation waits and then sees the NEW state (409 / 404), never the old one', async () => {
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // 1) Una aprobación que tarda en confirmar: la creación espera y ve «aprobado».
      await owner('m2', USERS.lead, E1);
      let hold = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM milestones WHERE id = 'm2' FOR UPDATE`;
        await tx.$executeRaw`UPDATE milestones SET status = 'approved'::"MilestoneStatus", approved_at = now(), approved_by = 'x@y.co' WHERE id = 'm2'`;
        await pause(600);
      });
      await pause(150);
      const c1 = await act('m2', ENG1); await hold;
      expect(c1.status).toBe(409); expect(await prisma.milestoneActivity.count()).toBe(0);
      await resetState(prisma);
      // 2) Un cambio de responsable que tarda en confirmar: el responsable anterior ya no puede crear al terminar la espera.
      await owner('m3', USERS.lead, E1);
      hold = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM milestones WHERE id = 'm3' FOR UPDATE`;
        await tx.$executeRaw`UPDATE milestones SET owner_id = ${E2}::uuid, owner_name = 'Julián Pardo' WHERE id = 'm3'`;
        await pause(600);
      });
      await pause(150);
      const c2 = await act('m3', ENG1); await hold;
      expect(c2.status).toBe(404); expect(await prisma.milestoneActivity.count()).toBe(0);
    });
    it('8 activities created at once get 8 different numbers', async () => {
      await owner('m2', USERS.lead, E1);
      const rs = await Promise.all([...Array(8)].map((_, i) => act('m2', ENG1, { title: `Paralela ${i}` })));
      expect(rs.every((r) => r.status === 201)).toBe(true);
      expect(new Set(rs.map((r) => r.body.code)).size).toBe(8);
    });
  });
});
