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
const patch = (tok: string | null, body?: unknown) => { let r = request(app.getHttpServer()).patch('/me/theme'); if (tok !== null) r = r.set('Authorization', bearer(tok)); return body === undefined ? r : r.send(body as object); };
const patchLanguage = (tok: string, body: unknown) => request(app.getHttpServer()).patch('/me/language').set('Authorization', bearer(tok)).send(body as object);
const themeOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).theme;
const reset = async () => { for (const [email, role] of SEED) await prisma.user.update({ where: { email }, data: { role: role as any, language: 'es', theme: 'system' } }); };
const allThemes = async () => Object.fromEntries(await Promise.all(SEED.map(async ([e]) => [e, await themeOf(e)])));
const ALL_SYSTEM = () => Object.fromEntries(SEED.map(([e]) => [e, 'system']));

beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
beforeEach(reset);
afterAll(async () => { await reset(); await app.close(); await prisma.$disconnect(); });

describe('theme preference: PATCH /me/theme (e2e, real PostgreSQL)', () => {
  it('everyone starts on «system» (they follow their computer) and the sign-in answer says so', async () => {
    for (const [email] of SEED) expect((await login(email)).body.user.theme).toBe('system');
  });

  it.each(SEED)('%s (%s) changes their own theme, it is stored, and the next sign-in opens in it', async (email) => {
    const r = await patch(await tokenOf(email), { theme: 'dark' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ theme: 'dark' }); // solo eso: nada más sale en la respuesta
    expect(await themeOf(email)).toBe('dark');
    expect((await login(email)).body.user.theme).toBe('dark');
    for (const back of ['light', 'system']) { expect((await patch(await tokenOf(email), { theme: back })).status).toBe(200); expect(await themeOf(email)).toBe(back); }
  });

  it('changing one person never touches the others', async () => {
    expect((await patch(await tokenOf('camila.soto@nexus.example'), { theme: 'dark' })).status).toBe(200);
    expect(await allThemes()).toEqual({ ...ALL_SYSTEM(), 'camila.soto@nexus.example': 'dark' });
  });

  it('is idempotent: the same value twice is fine', async () => {
    const t = await tokenOf('laura.rios@nexus.example');
    expect((await patch(t, { theme: 'light' })).status).toBe(200);
    expect((await patch(t, { theme: 'light' })).status).toBe(200);
    expect(await themeOf('laura.rios@nexus.example')).toBe('light');
  });

  it('changing the theme does not change the language, and the other way round', async () => {
    const t = await tokenOf('laura.rios@nexus.example');
    expect((await patch(t, { theme: 'dark' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'laura.rios@nexus.example' } })).language).toBe('es');
    expect((await patchLanguage(t, { language: 'en' })).status).toBe(200);
    expect(await themeOf('laura.rios@nexus.example')).toBe('dark');
  });

  describe('what is refused (400) and leaves everything as it was', () => {
    const bad: [string, unknown][] = [
      ['an unknown theme', { theme: 'auto' }], ['upper case', { theme: 'DARK' }], ['mixed case', { theme: 'Light' }], ['empty', { theme: '' }], ['with a space', { theme: 'dark ' }], ['leading space', { theme: ' light' }],
      ['a null', { theme: null }], ['a number', { theme: 1 }], ['a boolean', { theme: true }], ['an array', { theme: ['dark'] }], ['an object', { theme: { v: 'dark' } }],
      ['no field', {}], ['a prototype name', { theme: '__proto__' }], ['a language instead', { theme: 'es' }], ['SQL', { theme: "dark'; DROP TABLE users;--" }],
    ];
    it.each(bad)('%s', async (_n, body) => {
      const r = await patch(await tokenOf('laura.rios@nexus.example'), body);
      expect(r.status).toBe(400);
      expect(await allThemes()).toEqual(ALL_SYSTEM());
    });

    it('a body with no JSON at all', async () => { expect((await patch(await tokenOf('laura.rios@nexus.example'))).status).toBe(400); });

    it('extra fields are refused, so nobody can slip in a role, an email, a language or another person’s id', async () => {
      const other = await prisma.user.findUniqueOrThrow({ where: { email: 'diana.vega@nexus.example' } });
      const t = await tokenOf('laura.rios@nexus.example');
      for (const extra of [{ role: 'manager' }, { email: 'diana.vega@nexus.example' }, { userId: other.id }, { id: other.id }, { passwordHash: 'x' }, { language: 'en' }]) {
        expect((await patch(t, { theme: 'dark', ...extra })).status).toBe(400);
      }
      expect(await allThemes()).toEqual(ALL_SYSTEM());
      const laura = await prisma.user.findUniqueOrThrow({ where: { email: 'laura.rios@nexus.example' } });
      expect([laura.role, laura.language]).toEqual(['project_lead', 'es']);
    });
  });

  describe('tokens', () => {
    it('no token -> 401', async () => { expect((await patch(null, { theme: 'dark' })).status).toBe(401); });
    it.each(Object.entries(badTokens(token({ role: 'sales' }))))('%s -> 401 and nothing changes', async (_n, t) => {
      expect((await patch(t, { theme: 'dark' })).status).toBe(401);
      expect(await allThemes()).toEqual(ALL_SYSTEM());
    });
    it('a tampered payload keeps the old signature and is refused', async () => {
      const valid = await tokenOf('camila.soto@nexus.example'); const [h, p, s] = valid.split('.');
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
      const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: (await prisma.user.findUniqueOrThrow({ where: { email: 'diana.vega@nexus.example' } })).id })).toString('base64url')}.${s}`;
      expect((await patch(forged, { theme: 'dark' })).status).toBe(401);
      expect(await themeOf('diana.vega@nexus.example')).toBe('system');
    });
    it('a valid token of a person who no longer exists -> 404, not a silent success', async () => {
      expect((await patch(token({ id: randomUUID(), email: 'ghost@nexus.example', role: 'sales' }), { theme: 'dark' })).status).toBe(404);
    });
  });

  it('30 rounds: two people change their own theme at the same time and each ends with their own value', async () => {
    const [a, b] = [await tokenOf('laura.rios@nexus.example'), await tokenOf('camila.soto@nexus.example')];
    for (let i = 0; i < 30; i++) {
      const [ta, tb] = i % 2 ? ['dark', 'light'] : ['light', 'dark'];
      const [ra, rb] = await Promise.all([patch(a, { theme: ta }), patch(b, { theme: tb })]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      expect([await themeOf('laura.rios@nexus.example'), await themeOf('camila.soto@nexus.example')]).toEqual([ta, tb]);
    }
  });

  it('30 rounds: the same person sends system, light and dark at once: all answer 200 and the stored value is one of them (never anything else)', async () => {
    const t = await tokenOf('andres.mora@nexus.example');
    for (let i = 0; i < 30; i++) {
      const rs = await Promise.all([patch(t, { theme: 'system' }), patch(t, { theme: 'light' }), patch(t, { theme: 'dark' })]);
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(['system', 'light', 'dark']).toContain(await themeOf('andres.mora@nexus.example'));
    }
  });

  it('30 rounds: a theme change and a language change on the same person do not undo each other', async () => {
    const laura = await tokenOf('laura.rios@nexus.example');
    for (let i = 0; i < 30; i++) {
      const theme = i % 2 ? 'light' : 'dark'; const language = i % 2 ? 'es' : 'en';
      const [rt, rl] = await Promise.all([patch(laura, { theme }), patchLanguage(laura, { language })]);
      expect([rt.status, rl.status]).toEqual([200, 200]);
      const row = await prisma.user.findUniqueOrThrow({ where: { email: 'laura.rios@nexus.example' } });
      expect([row.theme, row.language]).toEqual([theme, language]); // ninguna de las dos escrituras pisó a la otra
    }
  });

  it('the database itself refuses a theme that is not system, light or dark, even if the code were wrong', async () => {
    for (const bad of ["'auto'", "'DARK'", "''"]) await expect(prisma.$executeRawUnsafe(`UPDATE users SET theme = ${bad} WHERE email = 'laura.rios@nexus.example'`)).rejects.toThrow(/users_theme_check/);
    await expect(prisma.$executeRawUnsafe(`UPDATE users SET theme = NULL WHERE email = 'laura.rios@nexus.example'`)).rejects.toThrow();
  });

  it('the user list of the manager does not grow new fields', async () => {
    const manager = await tokenOf('diana.vega@nexus.example');
    const r = await request(app.getHttpServer()).get('/users').set('Authorization', bearer(manager));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body[0]).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role']);
  });
});
