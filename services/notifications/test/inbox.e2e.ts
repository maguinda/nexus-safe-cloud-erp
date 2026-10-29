import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, OTHER_KEYS, resetState, token, unsigned, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false'; // estas pruebas no necesitan RabbitMQ
process.env.RATE_LIMIT = '100000';

describe('inbox: authentication, roles and per-person read marks (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const as = (u: { id: string; email: string; role: string }) => bearer(token(u));
  const get = (p: string, auth?: string) => { const r = request(app.getHttpServer()).get(p); return auth ? r.set('Authorization', auth) : r; };
  const post = (p: string, auth?: string) => { const r = request(app.getHttpServer()).post(p); return auth ? r.set('Authorization', auth) : r; };
  const other = { id: randomUUID(), email: 'otro.gerente@nexus.example', role: 'manager' };
  let n = 0;
  const add = (kind: string, roles: string[], at = new Date(Date.now() - (50 - n) * 1000)) => prisma.notification.create({ data: {
    eventId: randomUUID(), kind, severity: 'warning', audienceRoles: roles, params: { n: ++n }, correlationId: 'trace-in-0001', occurredAt: at } });

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(async () => { n = 0; await resetState(prisma); });
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('bad tokens are rejected with 401', () => {
    const bad: [string, string | undefined][] = [
      ['no token', undefined], ['empty bearer', 'Bearer '], ['basic scheme', 'Basic dXNlcjpwYXNz'], ['garbage', 'Bearer not.a.jwt'],
      ['expired', bearer(token(USERS.manager, { expiresIn: -60 }))], ['wrong audience', bearer(token(USERS.manager, { audience: 'other' }))],
      ['wrong issuer', bearer(token(USERS.manager, { issuer: 'evil' }))], ['signed with another key', bearer(token(USERS.manager, { key: OTHER_KEYS.privateKey }))],
      ['alg none', bearer(unsigned(USERS.manager))], ['unknown role', bearer(token({ ...USERS.manager, role: 'god' }))],
    ];
    it.each(bad)('%s', async (_n, auth) => {
      for (const [m, p] of [['get', '/notifications'], ['get', '/notifications/unread-count'], ['post', '/notifications/read-all'], ['post', `/notifications/${randomUUID()}/read`]] as const)
        expect((await (m === 'get' ? get(p, auth) : post(p, auth))).status).toBe(401);
    });
  });

  it('each role sees only the notifications of its role, newest first', async () => {
    await add('OverdueDetected', ['billing_analyst', 'manager']);
    await add('ThresholdBreached', ['manager']);
    await add('OverAllocationDetected', ['manager', 'sales']);
    const kinds = async (u: any) => (await get('/notifications', as(u))).body.items.map((i: any) => i.kind);
    expect(await kinds(USERS.manager)).toEqual(['OverAllocationDetected', 'ThresholdBreached', 'OverdueDetected']);
    expect(await kinds(USERS.billing)).toEqual(['OverdueDetected']);
    expect(await kinds(USERS.sales)).toEqual(['OverAllocationDetected']);
    expect(await kinds(USERS.lead)).toEqual([]);
    const r = await get('/notifications', as(USERS.manager));
    expect(r.body).toMatchObject({ total: 3, unread: 3 });
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['id', 'kind', 'occurredAt', 'params', 'read', 'severity']); // nada interno ni de otras personas
  });

  it('reading is per person: one manager reading does not mark it for another manager', async () => {
    const a = await add('ThresholdBreached', ['manager']);
    expect((await post(`/notifications/${a.id}/read`, as(USERS.manager))).status).toBe(204);
    expect((await get('/notifications/unread-count', as(USERS.manager))).body).toEqual({ unread: 0 });
    expect((await get('/notifications/unread-count', as(other))).body).toEqual({ unread: 1 });
    const mine = (await get('/notifications', as(USERS.manager))).body.items[0];
    expect(mine.read).toBe(true);
    expect((await get('/notifications', as(other))).body.items[0].read).toBe(false);
  });

  it('marking twice is fine; a notification of another role looks exactly like one that does not exist (404)', async () => {
    const a = await add('ThresholdBreached', ['manager']);
    expect((await post(`/notifications/${a.id}/read`, as(USERS.manager))).status).toBe(204);
    expect((await post(`/notifications/${a.id}/read`, as(USERS.manager))).status).toBe(204);
    const foreign = await post(`/notifications/${a.id}/read`, as(USERS.billing));
    const missing = await post(`/notifications/${randomUUID()}/read`, as(USERS.billing));
    expect(foreign.status).toBe(404); expect(missing.status).toBe(404);
    expect(foreign.body.message).toBe(missing.body.message);
    expect(await prisma.notificationRead.count({ where: { userId: USERS.billing.id } })).toBe(0);
    expect((await post('/notifications/not-a-uuid/read', as(USERS.manager))).status).toBe(400);
  });

  it('read-all marks only what the role can see, counts it, and a second call marks nothing', async () => {
    await add('OverdueDetected', ['billing_analyst', 'manager']); await add('ThresholdBreached', ['manager']);
    const r = await post('/notifications/read-all', as(USERS.billing));
    expect(r.status).toBe(200); expect(r.body).toEqual({ marked: 1 });
    expect((await get('/notifications/unread-count', as(USERS.manager))).body.unread).toBe(2);
    expect((await post('/notifications/read-all', as(USERS.billing))).body).toEqual({ marked: 0 });
    expect((await post('/notifications/read-all', as(USERS.manager))).body).toEqual({ marked: 2 });
    expect((await get('/notifications/unread-count', as(USERS.manager))).body.unread).toBe(0);
  });

  it('?unread=true hides what that person already read, and the total follows it; pagination does not repeat or skip', async () => {
    const all = []; for (let i = 0; i < 7; i++) all.push(await add('ThresholdBreached', ['manager']));
    await post(`/notifications/${all[6].id}/read`, as(USERS.manager)); // la más reciente
    const unread = (await get('/notifications?unread=true', as(USERS.manager))).body;
    expect(unread.total).toBe(6); expect(unread.items).toHaveLength(6); expect(unread.items.every((i: any) => !i.read)).toBe(true);
    const p1 = (await get('/notifications?limit=3&offset=0', as(USERS.manager))).body, p2 = (await get('/notifications?limit=3&offset=3', as(USERS.manager))).body, p3 = (await get('/notifications?limit=3&offset=6', as(USERS.manager))).body;
    expect(p1.total).toBe(7);
    const ids = [...p1.items, ...p2.items, ...p3.items].map((i: any) => i.id);
    expect(ids).toHaveLength(7); expect(new Set(ids).size).toBe(7);
  });

  it('rejects strange query values with 400 and never builds SQL from them', async () => {
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'unread=maybe', "limit=1;DROP TABLE notifications", 'unknown=1'])
      expect((await get(`/notifications?${q}`, as(USERS.manager))).status).toBe(400);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('50 people reading the same notification at once leave exactly one mark each and no errors', async () => {
    const a = await add('ThresholdBreached', ['manager']);
    const people = Array.from({ length: 50 }, () => ({ id: randomUUID(), email: 'x@nexus.example', role: 'manager' }));
    const res = await Promise.all(people.flatMap((p) => [post(`/notifications/${a.id}/read`, as(p)), post(`/notifications/${a.id}/read`, as(p))]));
    expect(res.every((r) => r.status === 204)).toBe(true);
    expect(await prisma.notificationRead.count()).toBe(50);
  });
});
