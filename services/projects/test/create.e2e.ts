import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.RELAY_ENABLED = 'false'; // estas pruebas no necesitan RabbitMQ
process.env.RATE_LIMIT = '100000';

describe('creating projects and milestones (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const lead = () => bearer(token(USERS.lead));
  const send = (method: 'get' | 'post', path: string, auth?: string, body?: unknown) => {
    let r = (request(app.getHttpServer()) as any)[method](path);
    if (auth) r = r.set('Authorization', auth);
    return body === undefined ? r : r.send(body);
  };
  const counts = async () => ({ projects: await prisma.project.count(), milestones: await prisma.milestone.count() });

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('roles', () => {
    it.each([['billing_analyst', USERS.billing], ['sales', USERS.sales], ['manager', USERS.manager]])('%s gets 403 on both creation routes and nothing is stored', async (_n, u) => {
      const before = await counts();
      expect((await send('post', '/projects', bearer(token(u)), { name: 'X', client: 'Y' })).status).toBe(403);
      expect((await send('post', '/projects/p1/milestones', bearer(token(u)), { name: 'X', amountCop: 10 })).status).toBe(403);
      expect(await counts()).toEqual(before);
    });
    it('no token or a tampered one gets 401', async () => {
      expect((await send('post', '/projects', undefined, { name: 'X', client: 'Y' })).status).toBe(401);
      expect((await send('post', '/projects/p1/milestones', bearer(token(USERS.lead) + 'x'), { name: 'X', amountCop: 10 })).status).toBe(401);
    });
    it('the role cannot be raised with a header or the body', async () => {
      const r = await request(app.getHttpServer()).post('/projects').set('Authorization', bearer(token(USERS.sales))).set('x-role', 'project_lead').send({ name: 'X', client: 'Y', role: 'project_lead' });
      expect(r.status).toBe(403);
    });
  });

  describe('the whole story', () => {
    it('creates a project, adds a milestone, sees both, approves it, and the event carries the amount', async () => {
      const p = await send('post', '/projects', lead(), { name: '  Warehouse   Wi-Fi rollout ', client: 'Nexus Safe-Cloud' });
      expect(p.status).toBe(201);
      expect(p.body).toEqual({ id: expect.stringMatching(/^p-[0-9a-f]{8}$/), name: 'Warehouse Wi-Fi rollout', client: 'Nexus Safe-Cloud', milestonesApproved: 0, milestonesTotal: 0 });
      const m = await send('post', `/projects/${p.body.id}/milestones`, lead(), { name: 'Site survey', amountCop: 12_000_000 });
      expect(m.status).toBe(201);
      expect(m.body).toEqual({ id: expect.stringMatching(/^m-[0-9a-f]{8}$/), projectId: p.body.id, name: 'Site survey', amountCop: 12_000_000, status: 'pending' });
      expect((await send('get', '/projects', lead())).body.find((x: any) => x.id === p.body.id)).toMatchObject({ milestonesTotal: 1, milestonesApproved: 0 });
      expect((await send('get', `/projects/${p.body.id}/milestones`, lead())).body).toEqual([m.body]);
      const a = await send('post', `/milestones/${m.body.id}/approve`, lead());
      expect(a.status).toBe(200);
      const ev = await prisma.outboxEvent.findUnique({ where: { id: a.body.eventId } });
      expect((ev?.payload as any).data).toMatchObject({ milestoneId: m.body.id, projectId: p.body.id, projectName: 'Warehouse Wi-Fi rollout', amountCop: 12_000_000, approvedBy: USERS.lead.email });
      expect((await send('post', `/milestones/${m.body.id}/approve`, lead())).status).toBe(409);
    });
    it('can add milestones to a seeded project too', async () => {
      const r = await send('post', '/projects/p1/milestones', lead(), { name: 'Extra', amountCop: 1 });
      expect(r.status).toBe(201);
      expect((await send('get', '/projects/p1/milestones', lead())).body.map((x: any) => x.id)).toContain(r.body.id);
    });
    it('keeps markup as plain text (the JSON is never HTML)', async () => {
      const r = await send('post', '/projects', lead(), { name: '<img src=x onerror=alert(1)>', client: '"; DROP TABLE projects;--' });
      expect(r.status).toBe(201);
      expect(r.headers['content-type']).toMatch(/application\/json/);
      expect(r.body.name).toBe('<img src=x onerror=alert(1)>');
      expect(await prisma.project.count()).toBeGreaterThanOrEqual(4); // la tabla sigue ahí
    });
  });

  describe('bad input is refused with 400 and nothing is stored', () => {
    const bodies: [string, unknown][] = [
      ['empty body', {}], ['name missing', { client: 'C' }], ['client missing', { name: 'N' }], ['empty name', { name: '', client: 'C' }], ['blank name', { name: '   ', client: 'C' }],
      ['name too long (121)', { name: 'a'.repeat(121), client: 'C' }], ['name is a number', { name: 5, client: 'C' }], ['name is an object', { name: { a: 1 }, client: 'C' }],
      ['name is a list', { name: ['x'], client: 'C' }], ['name is null', { name: null, client: 'C' }], ['control character', { name: 'a\u0000b', client: 'C' }],
      ['extra field (mass assignment: id)', { name: 'N', client: 'C', id: 'p1' }], ['extra field (status)', { name: 'N', client: 'C', status: 'approved' }],
      ['a list instead of an object', [{ name: 'N', client: 'C' }]], ['a string instead of an object', 'hello'],
    ];
    it.each(bodies)('project: %s', async (_n, body) => {
      const before = await counts();
      const r = await send('post', '/projects', lead(), body);
      expect(r.status).toBe(400);
      expect(r.body).toEqual(expect.objectContaining({ statusCode: 400, correlationId: expect.any(String) }));
      expect(await counts()).toEqual(before);
    });
    const ms: [string, unknown][] = [
      ['amount 0', { name: 'N', amountCop: 0 }], ['negative amount', { name: 'N', amountCop: -5 }], ['fractional amount', { name: 'N', amountCop: 10.5 }],
      ['amount over the cap', { name: 'N', amountCop: 1_000_000_001 }], ['amount as text', { name: 'N', amountCop: '100' }], ['amount null', { name: 'N', amountCop: null }],
      ['amount missing', { name: 'N' }], ['huge amount', { name: 'N', amountCop: 9e15 }], ['empty name', { name: '', amountCop: 10 }],
      ['born approved (status)', { name: 'N', amountCop: 10, status: 'approved' }], ['chosen id', { name: 'N', amountCop: 10, id: 'm1' }], ['approvedBy forged', { name: 'N', amountCop: 10, approvedBy: 'x@y.co' }],
    ];
    it.each(ms)('milestone: %s', async (_n, body) => {
      const before = await counts();
      expect((await send('post', '/projects/p1/milestones', lead(), body)).status).toBe(400);
      expect(await counts()).toEqual(before);
    });
    it('accepts exactly the limits: 120 characters and 1,000,000,000 pesos', async () => {
      expect((await send('post', '/projects', lead(), { name: 'a'.repeat(120), client: 'b'.repeat(120) })).status).toBe(201);
      expect((await send('post', '/projects/p1/milestones', lead(), { name: 'Big', amountCop: 1_000_000_000 })).status).toBe(201);
      expect((await send('post', '/projects/p1/milestones', lead(), { name: 'Tiny', amountCop: 1 })).status).toBe(201);
    });
    it('answers 404 for an unknown project and 400 for hostile ids', async () => {
      const before = await counts();
      expect((await send('post', '/projects/nope/milestones', lead(), { name: 'N', amountCop: 10 })).status).toBe(404);
      for (const id of ['..%2F..%2Fetc', "p1'--", 'a'.repeat(41), 'p 1']) expect((await send('post', `/projects/${id}/milestones`, lead(), { name: 'N', amountCop: 10 })).status).toBe(400);
      expect(await counts()).toEqual(before);
    });
    it('refuses a body over 10 KB with 413', async () => {
      const r = await send('post', '/projects', lead(), { name: 'N', client: 'C', pad: 'x'.repeat(11_000) });
      expect(r.status).toBe(413);
    });
  });

  it('CONCURRENCY: 40 simultaneous creations give 40 different ids and 40 stored rows', async () => {
    const before = await counts();
    const res = await Promise.all(Array.from({ length: 40 }, (_, i) => send('post', '/projects', lead(), { name: `Parallel ${i}`, client: 'C' })));
    expect(res.map((r) => r.status)).toEqual(Array(40).fill(201));
    expect(new Set(res.map((r) => r.body.id)).size).toBe(40);
    expect((await counts()).projects).toBe(before.projects + 40);
  });
});
