import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { verify } from 'jsonwebtoken';
import request from 'supertest';
import { BcryptPasswordHasher } from '../src/infrastructure/bcrypt-password-hasher';

process.env.LOGIN_RATE_LIMIT = '100000'; // los límites se prueban en rate-limit.e2e.ts y session-renewal-rate-limit.e2e.ts
process.env.REFRESH_RATE_LIMIT = '100000';
process.env.RATE_LIMIT = '100000';

const PUBLIC_KEY = readFileSync('../../infra/keys/jwt-public.pem', 'utf8');
const PASSWORD = 'Correct-Horse-Battery-9';
const HEADER = { 'X-Requested-With': 'erp-web' };
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('session renewal: login cookie, POST /auth/refresh and POST /auth/logout (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const emails: string[] = [];
  const server = () => app.getHttpServer();

  /** Una persona de prueba propia: estas pruebas cambian su rol, la borran y revocan sus sesiones, y las de demostración no se tocan. */
  async function makeUser(role: 'sales' | 'manager' | 'project_lead' = 'sales') {
    const email = `renew.${randomBytes(5).toString('hex')}@nexus.example`;
    emails.push(email);
    const u = await prisma.user.create({ data: { email, name: 'Renew Test', role, passwordHash: await new BcryptPasswordHasher().hash(PASSWORD) } });
    return { id: u.id, email };
  }
  const login = (email: string) => request(server()).post('/auth/login').send({ email, password: PASSWORD });
  const cookieOf = (res: { headers: Record<string, unknown> }): string | undefined => {
    const set = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
    return set.map((c) => /^erp_refresh=([^;]*)/.exec(c)?.[1]).find((v) => v !== undefined);
  };
  const setCookieHeader = (res: { headers: Record<string, unknown> }): string => ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []).join(' | ');
  /** Inicia sesión y devuelve el valor de la cookie de renovación. */
  async function session(email: string): Promise<string> { const r = await login(email); expect(r.status).toBe(200); return cookieOf(r)!; }
  const refresh = (cookie: string | null, extra: Record<string, string> = HEADER) => { let r = request(server()).post('/auth/refresh').set(extra); if (cookie !== null) r = r.set('Cookie', `erp_refresh=${cookie}`); return r.send(); };
  const logout = (cookie: string | null, extra: Record<string, string> = HEADER) => { let r = request(server()).post('/auth/logout').set(extra); if (cookie !== null) r = r.set('Cookie', `erp_refresh=${cookie}`); return r.send(); };
  const row = (token: string) => prisma.refreshToken.findUnique({ where: { tokenHash: sha(token) } });
  const family = async (token: string) => { const r = await row(token); return r ? prisma.refreshToken.findMany({ where: { familyId: r.familyId }, orderBy: { createdAt: 'asc' } }) : []; };

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  afterAll(async () => { await prisma.user.deleteMany({ where: { email: { in: emails } } }); await app.close(); await prisma.$disconnect(); });

  describe('login starts a session', () => {
    it('sets ONE HttpOnly, SameSite=Strict cookie only for /auth, with no Max-Age, a 43-character token, and never puts the token in the body', async () => {
      const u = await makeUser();
      const res = await login(u.email);
      expect(res.status).toBe(200);
      const set = ([] as string[]).concat(res.headers['set-cookie'] as unknown as string[]);
      expect(set).toHaveLength(1);
      expect(set[0]).toMatch(/^erp_refresh=[A-Za-z0-9_-]{43}; Path=\/auth; HttpOnly; SameSite=Strict$/);
      expect(set[0]).not.toMatch(/Max-Age|Expires|Secure/i);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'expiresIn', 'user']);
      expect(JSON.stringify(res.body)).not.toContain(cookieOf(res)!);
    });

    it('the database keeps only the SHA-256 of the token (never the token), with the inactivity and absolute limits', async () => {
      const u = await makeUser();
      const t = await session(u.email);
      const rows = await prisma.refreshToken.findMany({ where: { userId: u.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(sha(t));
      expect(JSON.stringify(rows)).not.toContain(t);
      const idle = rows[0].expiresAt.getTime() - rows[0].createdAt.getTime();
      const cap = rows[0].familyExpiresAt.getTime() - rows[0].createdAt.getTime();
      expect(Math.abs(idle - 30 * 60_000)).toBeLessThan(10_000);
      expect(Math.abs(cap - 8 * 3_600_000)).toBeLessThan(10_000);
    });

    it('a failed sign-in sets no cookie and starts no session', async () => {
      const u = await makeUser();
      const res = await request(server()).post('/auth/login').send({ email: u.email, password: 'wrong-password-123' });
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await prisma.refreshToken.count({ where: { userId: u.id } })).toBe(0);
    });

    it('every sign-in is its own session: two tokens, two families', async () => {
      const u = await makeUser();
      const a = await session(u.email); const b = await session(u.email);
      expect(a).not.toBe(b);
      expect((await row(a))!.familyId).not.toBe((await row(b))!.familyId);
    });
  });

  describe('POST /auth/refresh', () => {
    it('trades the cookie for a new JWT (same person, verifiable) and a NEW cookie; the old token is spent', async () => {
      const u = await makeUser();
      const t0 = await session(u.email);
      const res = await refresh(t0);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'expiresIn', 'user']);
      expect(res.body.expiresIn).toBe(900);
      expect(res.body.user).toEqual({ email: u.email, name: 'Renew Test', role: 'sales', language: 'es', theme: 'system' });
      const claims: any = verify(res.body.accessToken, PUBLIC_KEY, { algorithms: ['RS256'], issuer: 'identity-access', audience: 'erp-api' });
      expect(claims.sub).toBe(u.id);
      const t1 = cookieOf(res)!;
      expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(t1).not.toBe(t0);
      expect((await row(t0))!.usedAt).not.toBeNull();
      expect((await row(t1))!.usedAt).toBeNull();
      expect(setCookieHeader(res)).toMatch(/HttpOnly; SameSite=Strict$/);
      expect(JSON.stringify(res.body)).not.toContain(t1);
    });

    it('a chain of renewals keeps going with each newest cookie (the session survives as long as it is used)', async () => {
      const u = await makeUser();
      let t = await session(u.email);
      for (let i = 0; i < 8; i++) { const r = await refresh(t); expect(r.status).toBe(200); t = cookieOf(r)!; }
      expect((await family(t)).length).toBe(9);
    });

    it('the extra CSRF defense: without the X-Requested-With header (or with another value) it is 403 and the cookie is NOT spent', async () => {
      const u = await makeUser();
      const t = await session(u.email);
      expect((await refresh(t, {})).status).toBe(403);
      expect((await refresh(t, { 'X-Requested-With': 'XMLHttpRequest' })).status).toBe(403);
      expect((await refresh(t, { 'X-Requested-With': '' })).status).toBe(403);
      expect((await row(t))!.usedAt).toBeNull();
      expect((await refresh(t)).status).toBe(200); // y con la cabecera, sigue sirviendo
    });

    it.each([['no cookie at all', null], ['an empty cookie', ''], ['a token that does not exist', 'A'.repeat(43)], ['one that is too short', 'abc'], ['one that is too long', 'a'.repeat(44)], ['one with forbidden characters', `${'a'.repeat(42)}!`], ['a huge value', 'x'.repeat(3000)]])('%s -> 401 with the same message, and the cookie is cleared', async (_n, cookie) => {
      const res = await refresh(cookie as string | null);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid or expired session');
      expect(Object.keys(res.body).sort()).toEqual(['correlationId', 'error', 'message', 'statusCode']);
      expect(setCookieHeader(res)).toMatch(/erp_refresh=;.*Max-Age=0/);
    });

    it('a valid cookie with one character changed does not work (and does not harm the real one)', async () => {
      const u = await makeUser();
      const t = await session(u.email);
      const forged = `${t.slice(0, 20)}${t[20] === 'A' ? 'B' : 'A'}${t.slice(21)}`;
      expect((await refresh(forged)).status).toBe(401);
      expect((await refresh(t)).status).toBe(200);
    });

    it('a JWT is not a renewal token: the access token alone (as Bearer) cannot renew anything', async () => {
      const u = await makeUser();
      const l = await login(u.email);
      const res = await request(server()).post('/auth/refresh').set(HEADER).set('Authorization', `Bearer ${l.body.accessToken}`).send();
      expect(res.status).toBe(401);
      expect((await refresh(cookieOf(l)!)).status).toBe(200); // la sesión real no se tocó
    });

    it('the cookie value in the body, the query string or another header is ignored', async () => {
      const u = await makeUser();
      const t = await session(u.email);
      expect((await request(server()).post(`/auth/refresh?erp_refresh=${t}`).set(HEADER).send({ erp_refresh: t, refreshToken: t })).status).toBe(401);
      expect((await request(server()).post('/auth/refresh').set(HEADER).set('X-Refresh-Token', t).set('Authorization', t).send()).status).toBe(401);
      expect((await row(t))!.usedAt).toBeNull();
    });

    it('a cookie sent twice (another site of the same domain could plant one) is ignored, not guessed', async () => {
      const u = await makeUser();
      const t = await session(u.email);
      const res = await request(server()).post('/auth/refresh').set(HEADER).set('Cookie', `erp_refresh=${'B'.repeat(43)}; erp_refresh=${t}`).send();
      expect(res.status).toBe(401);
      expect((await row(t))!.usedAt).toBeNull();
    });

    it('re-reads the person: after a role change the NEW token carries the new role', async () => {
      const u = await makeUser('sales');
      const t = await session(u.email);
      await prisma.user.update({ where: { id: u.id }, data: { role: 'manager' } });
      const res = await refresh(t);
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('manager');
      expect((verify(res.body.accessToken, PUBLIC_KEY, { algorithms: ['RS256'] }) as any).role).toBe('manager');
    });

    it('a person who was deleted cannot renew (their sessions go with them)', async () => {
      const u = await makeUser();
      const t = await session(u.email);
      await prisma.user.delete({ where: { id: u.id } });
      expect((await refresh(t)).status).toBe(401);
      expect(await row(t)).toBeNull();
    });

    it('inactivity: a token past its expiry does not renew', async () => {
      const u = await makeUser();
      const t = await session(u.email);
      await prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await refresh(t);
      expect(res.status).toBe(401);
      expect(setCookieHeader(res)).toMatch(/Max-Age=0/);
    });

    it('the absolute limit: every token ends no later than its session, so once the cap passes the session can no longer be renewed', async () => {
      const u = await makeUser();
      let t = await session(u.email);
      // El tope queda en 100 s: el siguiente token vence con la familia, no a los 30 min de inactividad.
      await prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { familyExpiresAt: new Date(Date.now() + 100_000), expiresAt: new Date(Date.now() + 100_000) } });
      const r = await refresh(t); expect(r.status).toBe(200);
      t = cookieOf(r)!;
      const next = (await row(t))!;
      expect(next.expiresAt.getTime()).toBeLessThanOrEqual(next.familyExpiresAt.getTime());
      expect(next.familyExpiresAt.getTime() - Date.now()).toBeLessThan(101_000);
      await prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { familyExpiresAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() - 2000) } });
      expect((await refresh(t)).status).toBe(401);
    });

    it('the DATABASE itself refuses a token that outlives its session (so that state cannot exist, even by mistake)', async () => {
      const u = await makeUser();
      await session(u.email);
      await expect(prisma.$executeRaw`UPDATE "refresh_tokens" SET "expires_at" = "family_expires_at" + interval '1 hour' WHERE "user_id" = ${u.id}::uuid`).rejects.toThrow(/refresh_tokens_expiry_check|violates check constraint/);
      await expect(prisma.$executeRaw`UPDATE "refresh_tokens" SET "token_hash" = 'not-a-hash' WHERE "user_id" = ${u.id}::uuid`).rejects.toThrow(/refresh_tokens_hash_check|violates check constraint/);
    });

    it('a race (the same token used again a moment later) answers 409 «retry», revokes NOTHING and keeps the cookie; the new token still works', async () => {
      const u = await makeUser();
      const t0 = await session(u.email);
      const first = await refresh(t0);
      const t1 = cookieOf(first)!;
      const second = await refresh(t0);
      expect(second.status).toBe(409);
      expect(second.body.message).toBe('Session renewal in progress, retry');
      expect(setCookieHeader(second)).toBe(''); // no toca la cookie que el navegador ya tiene
      expect((await family(t0)).every((r) => r.revokedAt === null)).toBe(true);
      expect((await refresh(t1)).status).toBe(200);
    });

    it('REUSE of a spent token after the margin (a copy): 401, the cookie is cleared, and the WHOLE session is revoked, including the legitimate token', async () => {
      const u = await makeUser();
      const t0 = await session(u.email);
      const r1 = await refresh(t0);
      const t1 = cookieOf(r1)!;
      await prisma.refreshToken.updateMany({ where: { tokenHash: sha(t0) }, data: { usedAt: new Date(Date.now() - 11_000) } }); // hace 11 s: fuera del margen de 10 s
      const stolen = await refresh(t0);
      expect(stolen.status).toBe(401);
      expect(setCookieHeader(stolen)).toMatch(/Max-Age=0/);
      expect((await family(t0)).every((r) => r.revokedAt !== null)).toBe(true);
      expect((await refresh(t1)).status).toBe(401); // la persona legítima también pierde la sesión: tiene que volver a entrar
    });

    it('revoking one session does not touch the other sessions of the same person', async () => {
      const u = await makeUser();
      const a = await session(u.email); const b = await session(u.email);
      const a1 = cookieOf(await refresh(a))!;
      await prisma.refreshToken.updateMany({ where: { tokenHash: sha(a) }, data: { usedAt: new Date(Date.now() - 20_000) } });
      expect((await refresh(a)).status).toBe(401);
      expect((await refresh(a1)).status).toBe(401);
      expect((await refresh(b)).status).toBe(200);
    });

    it('30 rounds of 5 renewals at the same time with the same token: exactly ONE wins, the rest get 409, never a 500, nothing is revoked and the winner\'s token works', async () => {
      const u = await makeUser();
      for (let round = 0; round < 30; round++) {
        const t0 = await session(u.email);
        const results = await Promise.all(Array.from({ length: 5 }, () => refresh(t0)));
        const codes = results.map((r) => r.status).sort();
        expect({ ronda: round + 1, codes }).toEqual({ ronda: round + 1, codes: [200, 409, 409, 409, 409] });
        const winner = results.find((r) => r.status === 200)!;
        const fam = await family(t0);
        expect(fam).toHaveLength(2); // el gastado y su sucesor: ningún token de más
        expect(fam.filter((r) => r.usedAt !== null)).toHaveLength(1);
        expect(fam.every((r) => r.revokedAt === null)).toBe(true);
        expect((await refresh(cookieOf(winner)!)).status).toBe(200);
      }
    }, 180_000);

    it('20 different sessions renewing at the same time all succeed and none interferes with another', async () => {
      const u = await makeUser();
      const tokens = await Promise.all(Array.from({ length: 20 }, () => session(u.email)));
      const results = await Promise.all(tokens.map((t) => refresh(t)));
      expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
      expect(new Set(results.map((r) => cookieOf(r))).size).toBe(20);
    });

    it('the access token it returns opens the API like the one from the login (same issuer and audience)', async () => {
      const u = await makeUser('manager');
      const res = await refresh(await session(u.email));
      const claims: any = verify(res.body.accessToken, PUBLIC_KEY, { algorithms: ['RS256'], issuer: 'identity-access', audience: 'erp-api' });
      expect(claims.role).toBe('manager');
      expect(claims.exp - claims.iat).toBe(900);
      expect(claims.jti).toEqual(expect.any(String));
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the whole session and clears the cookie: nothing renews afterwards', async () => {
      const u = await makeUser();
      const t0 = await session(u.email);
      const t1 = cookieOf(await refresh(t0))!;
      const res = await logout(t1);
      expect(res.status).toBe(204);
      expect(setCookieHeader(res)).toMatch(/erp_refresh=;.*Max-Age=0/);
      expect((await family(t1)).every((r) => r.revokedAt !== null)).toBe(true);
      expect((await refresh(t1)).status).toBe(401);
      expect((await refresh(t0)).status).toBe(401);
    });

    it('logging out with an OLD (spent) token of the session also ends it, so a leaked old token cannot keep a session alive', async () => {
      const u = await makeUser();
      const t0 = await session(u.email);
      const t1 = cookieOf(await refresh(t0))!;
      expect((await logout(t0)).status).toBe(204);
      expect((await refresh(t1)).status).toBe(401);
    });

    it('without the X-Requested-With header it is 403 and the session is NOT ended (a foreign page cannot sign people out)', async () => {
      const u = await makeUser();
      const t = await session(u.email);
      expect((await logout(t, {})).status).toBe(403);
      expect((await row(t))!.revokedAt).toBeNull();
      expect((await refresh(t)).status).toBe(200);
    });

    it('with no session or a junk cookie it is still 204 (signing out twice is fine) and the cookie is cleared', async () => {
      for (const c of [null, 'garbage', 'A'.repeat(43)]) { const res = await logout(c as string | null); expect(res.status).toBe(204); expect(setCookieHeader(res)).toMatch(/Max-Age=0/); }
    });

    it('does not touch the person\'s other sessions', async () => {
      const u = await makeUser();
      const a = await session(u.email); const b = await session(u.email);
      await logout(a);
      expect((await refresh(b)).status).toBe(200);
    });
  });

  describe('the cookie flags depend on HTTPS', () => {
    it('with COOKIE_SECURE=true the cookies carry Secure (login, renewal and clearing)', async () => {
      const previous = process.env.COOKIE_SECURE;
      process.env.COOKIE_SECURE = 'true';
      const { createApp } = require('../src/app.factory');
      const secureApp: INestApplication = await createApp(); await secureApp.init();
      try {
        const u = await makeUser();
        const l = await request(secureApp.getHttpServer()).post('/auth/login').send({ email: u.email, password: PASSWORD });
        expect(setCookieHeader(l)).toMatch(/; Secure$/);
        const r = await request(secureApp.getHttpServer()).post('/auth/refresh').set(HEADER).set('Cookie', `erp_refresh=${cookieOf(l)!}`).send();
        expect(setCookieHeader(r)).toMatch(/; Secure$/);
        const out = await request(secureApp.getHttpServer()).post('/auth/logout').set(HEADER).send();
        expect(setCookieHeader(out)).toMatch(/Max-Age=0.*; Secure$/);
      } finally { await secureApp.close(); if (previous === undefined) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = previous; }
    });
  });
});
