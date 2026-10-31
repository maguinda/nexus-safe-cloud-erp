import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import { BcryptPasswordHasher } from '../src/infrastructure/bcrypt-password-hasher';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REFRESH_RATE_LIMIT = '100000';
process.env.RATE_LIMIT = '100000';
process.env.USERS_WRITE_RATE_LIMIT = '100000';

const PASSWORD = 'Correct-Horse-Battery-9';
const HEADER = { 'X-Requested-With': 'erp-web' };

describe('close all sessions: POST /auth/logout-all and POST /users/:id/sessions/revoke (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const emails: string[] = [];
  const server = () => app.getHttpServer();
  async function makeUser(role: 'sales' | 'manager' = 'sales') {
    const email = `revoke.${randomBytes(5).toString('hex')}@nexus.example`;
    emails.push(email);
    const u = await prisma.user.create({ data: { email, name: 'Revoke Test', role, passwordHash: await new BcryptPasswordHasher().hash(PASSWORD) } });
    return { id: u.id, email };
  }
  const login = (email: string) => request(server()).post('/auth/login').send({ email, password: PASSWORD });
  const cookieOf = (res: { headers: Record<string, unknown> }) => ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []).map((c) => /^erp_refresh=([^;]*)/.exec(c)?.[1]).find((v) => v !== undefined);
  async function session(email: string) { const r = await login(email); expect(r.status).toBe(200); return { cookie: cookieOf(r)!, access: r.body.accessToken as string }; }
  const refresh = (cookie: string) => request(server()).post('/auth/refresh').set(HEADER).set('Cookie', `erp_refresh=${cookie}`);
  const live = (userId: string) => prisma.refreshToken.count({ where: { userId, revokedAt: null } });

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  afterAll(async () => { await prisma.user.deleteMany({ where: { email: { in: emails } } }); await app.close(); await prisma.$disconnect(); });

  describe('POST /auth/logout-all (the signed-in person)', () => {
    it('closes EVERY session of that person (three devices), clears the cookie, and nothing renews afterwards; another person is untouched', async () => {
      const me = await makeUser(); const other = await makeUser();
      const s1 = await session(me.email); const s2 = await session(me.email); const s3 = await session(me.email); const o = await session(other.email);
      const res = await request(server()).post('/auth/logout-all').set('Authorization', `Bearer ${s1.access}`);
      expect(res.status).toBe(204);
      expect(([] as string[]).concat(res.headers['set-cookie'] as any).join(' ')).toMatch(/erp_refresh=;|Max-Age=0|Expires=Thu, 01 Jan 1970/);
      for (const s of [s1, s2, s3]) expect((await refresh(s.cookie)).status).toBe(401);
      expect(await live(me.id)).toBe(0);
      expect((await refresh(o.cookie)).status).toBe(200);
    });
    it('the person comes from the signed token: a userId in the body or the query changes nothing', async () => {
      const me = await makeUser(); const victim = await makeUser();
      const s = await session(me.email); const v = await session(victim.email);
      const res = await request(server()).post(`/auth/logout-all?userId=${victim.id}`).set('Authorization', `Bearer ${s.access}`).send({ userId: victim.id, id: victim.id });
      expect(res.status).toBe(204);
      expect((await refresh(v.cookie)).status).toBe(200);
      expect((await refresh(s.cookie)).status).toBe(401);
    });
    it('without a token, or with a tampered one, it is 401 and nobody is signed out', async () => {
      const me = await makeUser(); const s = await session(me.email);
      expect((await request(server()).post('/auth/logout-all')).status).toBe(401);
      expect((await request(server()).post('/auth/logout-all').set('Authorization', `Bearer ${s.access}x`)).status).toBe(401);
      expect(await live(me.id)).toBe(1);
    });
    it('signing out everywhere twice is fine', async () => {
      const me = await makeUser(); const s = await session(me.email);
      expect((await request(server()).post('/auth/logout-all').set('Authorization', `Bearer ${s.access}`)).status).toBe(204);
      expect((await request(server()).post('/auth/logout-all').set('Authorization', `Bearer ${s.access}`)).status).toBe(204);
    });
    it('the person can sign in again afterwards with the password', async () => {
      const me = await makeUser(); const s = await session(me.email);
      await request(server()).post('/auth/logout-all').set('Authorization', `Bearer ${s.access}`);
      const again = await session(me.email);
      expect((await refresh(again.cookie)).status).toBe(200);
    });
  });

  describe('POST /users/:id/sessions/revoke (a manager closes someone else\'s sessions)', () => {
    it('a manager closes every session of another person and gets the count; the person can sign in again', async () => {
      const mgr = await makeUser('manager'); const t = await makeUser();
      const m = await session(mgr.email); const a = await session(t.email); const b = await session(t.email);
      const res = await request(server()).post(`/users/${t.id}/sessions/revoke`).set('Authorization', `Bearer ${m.access}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ revoked: 2 });
      expect((await refresh(a.cookie)).status).toBe(401);
      expect((await refresh(b.cookie)).status).toBe(401);
      expect((await refresh(m.cookie)).status).toBe(200); // la del gerente no se toca
      expect((await login(t.email)).status).toBe(200);
    });
    it('only a manager: a sales person gets 403 and the target keeps the session; no token is 401', async () => {
      const sales = await makeUser(); const t = await makeUser();
      const s = await session(sales.email); const a = await session(t.email);
      expect((await request(server()).post(`/users/${t.id}/sessions/revoke`).set('Authorization', `Bearer ${s.access}`)).status).toBe(403);
      expect((await request(server()).post(`/users/${t.id}/sessions/revoke`)).status).toBe(401);
      expect((await refresh(a.cookie)).status).toBe(200);
    });
    it('the role is read from the database: a manager who was demoted after logging in (token still says manager) gets 403', async () => {
      const mgr = await makeUser('manager'); const other = await makeUser('manager'); const t = await makeUser();
      const m = await session(mgr.email);
      await prisma.user.update({ where: { id: mgr.id }, data: { role: 'sales' } });
      const a = await session(t.email);
      expect((await request(server()).post(`/users/${t.id}/sessions/revoke`).set('Authorization', `Bearer ${m.access}`)).status).toBe(403);
      expect((await refresh(a.cookie)).status).toBe(200);
      expect(other.id).toBeDefined();
    });
    it('unknown person is 404, a malformed id is 400', async () => {
      const mgr = await makeUser('manager'); const m = await session(mgr.email);
      expect((await request(server()).post(`/users/${randomUUID()}/sessions/revoke`).set('Authorization', `Bearer ${m.access}`)).status).toBe(404);
      expect((await request(server()).post('/users/not-a-uuid/sessions/revoke').set('Authorization', `Bearer ${m.access}`)).status).toBe(400);
    });
    it('a person with no sessions: 200 and { revoked: 0 }', async () => {
      const mgr = await makeUser('manager'); const t = await makeUser(); const m = await session(mgr.email);
      const res = await request(server()).post(`/users/${t.id}/sessions/revoke`).set('Authorization', `Bearer ${m.access}`);
      expect(res.body).toEqual({ revoked: 0 });
    });
  });

  describe('races', () => {
    it('40 rounds: closing everything while a renewal is in flight never leaves a live token, and the renewed cookie does not work either', async () => {
      const me = await makeUser();
      for (let i = 0; i < 40; i++) {
        const s = await session(me.email);
        const [r, out] = await Promise.all([refresh(s.cookie), request(server()).post('/auth/logout-all').set('Authorization', `Bearer ${s.access}`)]);
        expect(out.status).toBe(204);
        expect([200, 401, 409]).toContain(r.status);
        expect(await live(me.id)).toBe(0); // la invariante: nada vivo después del cierre
        const fresh = cookieOf(r);
        if (r.status === 200 && fresh) expect((await refresh(fresh)).status).toBe(401);
      }
    });
    it('30 rounds: five renewals plus a manager revoking at the same time end with zero live tokens and no 500', async () => {
      const mgr = await makeUser('manager'); const m = await session(mgr.email); const t = await makeUser();
      for (let i = 0; i < 30; i++) {
        const s = await session(t.email);
        const calls = [...Array(5)].map(() => refresh(s.cookie)) as Promise<{ status: number }>[];
        const all = await Promise.all([...calls, request(server()).post(`/users/${t.id}/sessions/revoke`).set('Authorization', `Bearer ${m.access}`)]);
        expect(all.every((x) => x.status !== 500)).toBe(true);
        expect(await live(t.id)).toBe(0);
      }
    });
  });
});
