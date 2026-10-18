import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { sign } from 'jsonwebtoken';
import { readFileSync } from 'fs';
import request from 'supertest';
import { bearer, OTHER_KEYS, token, unsigned, USERS } from './helpers';

process.env.RELAY_ENABLED = 'false'; // estas pruebas no necesitan RabbitMQ
process.env.RATE_LIMIT = '100000';

describe('authentication and roles (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const get = (path: string, auth?: string) => { const r = request(app.getHttpServer()).get(path); return auth ? r.set('Authorization', auth) : r; };
  const post = (path: string, auth?: string) => { const r = request(app.getHttpServer()).post(path); return auth ? r.set('Authorization', auth) : r; };

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory');
    app = await createApp();
    await app.init();
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  describe('every protected route rejects bad tokens with 401', () => {
    const lead = USERS.lead;
    const bad: [string, string | undefined][] = [
      ['no token', undefined],
      ['empty bearer', 'Bearer '],
      ['not a bearer scheme', 'Basic dXNlcjpwYXNz'],
      ['garbage', 'Bearer not.a.jwt'],
      ['expired', bearer(token(lead, { expiresIn: -60 }))],
      ['signed with another key', bearer(token(lead, { key: OTHER_KEYS.privateKey }))],
      ['wrong issuer', bearer(token(lead, { issuer: 'evil' }))],
      ['wrong audience', bearer(token(lead, { audience: 'other-api' }))],
      ['alg=none (no signature)', bearer(unsigned(lead))],
      ['unknown role', bearer(token({ ...lead, role: 'admin' }))],
      ['payload tampered (role changed), signature kept', (() => { const [h, , s] = token(USERS.sales).split('.'); const p = Buffer.from(JSON.stringify({ sub: 'x', email: 'a@b.co', role: 'project_lead', iss: 'identity-access', aud: 'erp-api', exp: 9999999999 })).toString('base64url'); return bearer(`${h}.${p}.${s}`); })()],
      ['HS256 signed with the public key as secret', bearer(sign({ email: lead.email, role: lead.role }, readFileSync('../../infra/keys/jwt-public.pem', 'utf8'), { algorithm: 'HS256', subject: lead.id, issuer: 'identity-access', audience: 'erp-api' }))],
    ];
    const routes: [string, string][] = [['GET', '/projects'], ['GET', '/projects/p1/milestones'], ['POST', '/milestones/m2/approve']];
    for (const [name, auth] of bad) {
      it(`${name}`, async () => {
        for (const [method, path] of routes) {
          const res = method === 'GET' ? await get(path, auth) : await post(path, auth);
          expect({ path, status: res.status }).toEqual({ path, status: 401 });
          expect(res.body.message).toBeDefined();
          expect(JSON.stringify(res.body)).not.toMatch(/jwt|signature|algorithm|key/i); // sin pistas sobre el motivo exacto
        }
      });
    }
    it('a rejected approval does not change anything', async () => {
      await post('/milestones/m2/approve', bearer(token(USERS.lead, { expiresIn: -60 })));
      const m = await prisma.milestone.findUnique({ where: { id: 'm2' } });
      expect(m?.status).toBe('pending');
      expect(await prisma.outboxEvent.count({ where: { aggregateId: 'm2' } })).toBe(0);
    });
  });

  describe('roles', () => {
    it('everyone with a valid token can read projects and milestones', async () => {
      for (const u of Object.values(USERS)) {
        const p = await get('/projects', bearer(token(u)));
        expect(p.status).toBe(200);
        expect(p.body.map((x: any) => x.id)).toEqual(['p1', 'p2', 'p3']);
        const m = await get('/projects/p1/milestones', bearer(token(u)));
        expect(m.status).toBe(200);
        expect(Object.keys(m.body[0]).sort()).toEqual(['amountCop', 'id', 'name', 'projectId', 'status']); // sin approvedBy
      }
    });

    it('sales and billing_analyst get 403 when approving, and nothing changes', async () => {
      for (const u of [USERS.sales, USERS.billing]) {
        const res = await post('/milestones/m2/approve', bearer(token(u)));
        expect(res.status).toBe(403);
        expect(res.body).toEqual(expect.objectContaining({ statusCode: 403, correlationId: expect.any(String) }));
      }
      expect((await prisma.milestone.findUnique({ where: { id: 'm2' } }))?.status).toBe('pending');
      expect(await prisma.outboxEvent.count()).toBe(0);
    });

    it('the role cannot be raised with a header or the body', async () => {
      const res = await post('/milestones/m2/approve', bearer(token(USERS.sales))).set('x-role', 'project_lead').send({ role: 'project_lead', approvedBy: 'laura.rios@nexus.example' });
      expect(res.status).toBe(403);
    });
  });

  describe('input handling', () => {
    it.each([['..%2F..%2Fetc'], ['m2;DROP TABLE milestones'], ["m2'--"], ['a'.repeat(41)], ['m 2']])('rejects the id %s with 400', async (id) => {
      const res = await post(`/milestones/${encodeURIComponent(id)}/approve`, bearer(token(USERS.lead)));
      expect(res.status).toBe(400);
    });
    it('answers 404 for unknown project and milestone', async () => {
      expect((await get('/projects/nope/milestones', bearer(token(USERS.lead)))).status).toBe(404);
      expect((await post('/milestones/nope/approve', bearer(token(USERS.lead)))).status).toBe(404);
    });
    it('keeps health public and sets security headers', async () => {
      const res = await get('/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});
