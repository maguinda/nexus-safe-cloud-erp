import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { badTokens, bearer, token } from './helpers';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.USERS_WRITE_RATE_LIMIT = '100000';
process.env.ME_WRITE_RATE_LIMIT = '100000';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD as string;
const prisma = new PrismaClient();
const SEED: [string, string][] = [['laura.rios@nexus.example', 'project_lead'], ['andres.mora@nexus.example', 'billing_analyst'], ['camila.soto@nexus.example', 'sales'], ['diana.vega@nexus.example', 'manager']];

let app: INestApplication;
const login = (email: string) => request(app.getHttpServer()).post('/auth/login').send({ email, password: DEMO_PASSWORD });
const tokenOf = async (email: string) => (await login(email)).body.accessToken as string;
const patch = (tok: string | null, body?: unknown) => { let r = request(app.getHttpServer()).patch('/me/language'); if (tok !== null) r = r.set('Authorization', bearer(tok)); return body === undefined ? r : r.send(body as object); };
const langOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).language;
const reset = async () => { for (const [email, role] of SEED) await prisma.user.update({ where: { email }, data: { role: role as any, language: 'es' } }); };
const allLanguages = async () => Object.fromEntries(await Promise.all(SEED.map(async ([e]) => [e, await langOf(e)])));

beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
beforeEach(reset);
afterAll(async () => { await reset(); await app.close(); await prisma.$disconnect(); });

describe('language preference: PATCH /me/language (e2e, real PostgreSQL)', () => {
  it('everyone starts in Spanish and the sign-in answer says so', async () => {
    for (const [email] of SEED) expect((await login(email)).body.user.language).toBe('es');
  });

  it.each(SEED)('%s (%s) changes their own language, it is stored, and the next sign-in opens in it', async (email) => {
    const r = await patch(await tokenOf(email), { language: 'en' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ language: 'en' }); // solo eso: nada más sale en la respuesta
    expect(await langOf(email)).toBe('en');
    expect((await login(email)).body.user.language).toBe('en');
    // y puede volver a español
    expect((await patch(await tokenOf(email), { language: 'es' })).status).toBe(200);
    expect(await langOf(email)).toBe('es');
  });

  it('changing one person never touches the others', async () => {
    expect((await patch(await tokenOf('camila.soto@nexus.example'), { language: 'en' })).status).toBe(200);
    expect(await allLanguages()).toEqual({ 'laura.rios@nexus.example': 'es', 'andres.mora@nexus.example': 'es', 'camila.soto@nexus.example': 'en', 'diana.vega@nexus.example': 'es' });
  });

  it('is idempotent: the same value twice is fine', async () => {
    const t = await tokenOf('laura.rios@nexus.example');
    expect((await patch(t, { language: 'en' })).status).toBe(200);
    expect((await patch(t, { language: 'en' })).status).toBe(200);
    expect(await langOf('laura.rios@nexus.example')).toBe('en');
  });

  describe('what is refused (400) and leaves everything as it was', () => {
    const bad: [string, unknown][] = [
      ['an unknown language', { language: 'fr' }], ['upper case', { language: 'ES' }], ['mixed case', { language: 'En' }], ['empty', { language: '' }], ['with a space', { language: 'es ' }],
      ['a null', { language: null }], ['a number', { language: 1 }], ['a boolean', { language: true }], ['an array', { language: ['en'] }], ['an object', { language: { v: 'en' } }],
      ['no field', {}], ['a prototype name', { language: '__proto__' }], ['SQL', { language: "en'; DROP TABLE users;--" }],
    ];
    it.each(bad)('%s', async (_n, body) => {
      const r = await patch(await tokenOf('laura.rios@nexus.example'), body);
      expect(r.status).toBe(400);
      expect(await allLanguages()).toEqual(Object.fromEntries(SEED.map(([e]) => [e, 'es'])));
    });

    it('a body with no JSON at all', async () => { expect((await patch(await tokenOf('laura.rios@nexus.example'))).status).toBe(400); });

    it('extra fields are refused, so nobody can slip in a role, an email or another person’s id', async () => {
      const other = await prisma.user.findUniqueOrThrow({ where: { email: 'diana.vega@nexus.example' } });
      const t = await tokenOf('laura.rios@nexus.example');
      for (const extra of [{ role: 'manager' }, { email: 'diana.vega@nexus.example' }, { userId: other.id }, { id: other.id }, { passwordHash: 'x' }]) {
        expect((await patch(t, { language: 'en', ...extra })).status).toBe(400);
      }
      expect(await allLanguages()).toEqual(Object.fromEntries(SEED.map(([e]) => [e, 'es'])));
      expect((await prisma.user.findUniqueOrThrow({ where: { email: 'laura.rios@nexus.example' } })).role).toBe('project_lead');
    });
  });

  describe('tokens', () => {
    it('no token -> 401', async () => { expect((await patch(null, { language: 'en' })).status).toBe(401); });
    it.each(Object.entries(badTokens(token({ role: 'sales' }))))('%s -> 401 and nothing changes', async (_n, t) => {
      expect((await patch(t, { language: 'en' })).status).toBe(401);
      expect(await allLanguages()).toEqual(Object.fromEntries(SEED.map(([e]) => [e, 'es'])));
    });
    it('a tampered payload keeps the old signature and is refused', async () => {
      const valid = await tokenOf('camila.soto@nexus.example'); const [h, p, s] = valid.split('.');
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
      const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: (await prisma.user.findUniqueOrThrow({ where: { email: 'diana.vega@nexus.example' } })).id })).toString('base64url')}.${s}`;
      expect((await patch(forged, { language: 'en' })).status).toBe(401);
      expect(await langOf('diana.vega@nexus.example')).toBe('es');
    });
    it('a valid token of a person who no longer exists -> 404, not a silent success', async () => {
      expect((await patch(token({ id: randomUUID(), email: 'ghost@nexus.example', role: 'sales' }), { language: 'en' })).status).toBe(404);
    });
  });

  it('30 rounds: two people change their own language at the same time and each ends with their own value', async () => {
    const [a, b] = [await tokenOf('laura.rios@nexus.example'), await tokenOf('camila.soto@nexus.example')];
    for (let i = 0; i < 30; i++) {
      const [la, lb] = i % 2 ? ['en', 'es'] : ['es', 'en'];
      const [ra, rb] = await Promise.all([patch(a, { language: la }), patch(b, { language: lb })]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      expect([await langOf('laura.rios@nexus.example'), await langOf('camila.soto@nexus.example')]).toEqual([la, lb]);
    }
  });

  it('30 rounds: the same person sends es and en at once: both answer 200 and the stored value is one of the two (never anything else)', async () => {
    const t = await tokenOf('andres.mora@nexus.example');
    for (let i = 0; i < 30; i++) {
      const rs = await Promise.all([patch(t, { language: 'es' }), patch(t, { language: 'en' }), patch(t, { language: 'es' })]);
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(['es', 'en']).toContain(await langOf('andres.mora@nexus.example'));
    }
  });

  it('30 rounds: a language change and a role change on the same person do not undo each other', async () => {
    const manager = await tokenOf('diana.vega@nexus.example'); const laura = await tokenOf('laura.rios@nexus.example');
    const lauraId = (await prisma.user.findUniqueOrThrow({ where: { email: 'laura.rios@nexus.example' } })).id;
    for (let i = 0; i < 30; i++) {
      const role = i % 2 ? 'project_lead' : 'sales'; const language = i % 2 ? 'es' : 'en';
      const [rl, rr] = await Promise.all([patch(laura, { language }), request(app.getHttpServer()).patch(`/users/${lauraId}/role`).set('Authorization', bearer(manager)).send({ role })]);
      expect([rl.status, rr.status]).toEqual([200, 200]);
      const row = await prisma.user.findUniqueOrThrow({ where: { email: 'laura.rios@nexus.example' } });
      expect([row.role, row.language]).toEqual([role, language]); // ninguna de las dos escrituras pisó a la otra
    }
  });

  it('the database itself refuses a language that is not es or en, even if the code were wrong', async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE users SET language = 'fr' WHERE email = 'laura.rios@nexus.example'`)).rejects.toThrow(/users_language_check/);
    await expect(prisma.$executeRawUnsafe(`UPDATE users SET language = 'EN' WHERE email = 'laura.rios@nexus.example'`)).rejects.toThrow(/users_language_check/);
    await expect(prisma.$executeRawUnsafe(`UPDATE users SET language = NULL WHERE email = 'laura.rios@nexus.example'`)).rejects.toThrow();
  });

  it('the user list of the manager does not grow new fields', async () => {
    const manager = await tokenOf('diana.vega@nexus.example');
    const r = await request(app.getHttpServer()).get('/users').set('Authorization', bearer(manager));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body[0]).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role']);
  });
});
