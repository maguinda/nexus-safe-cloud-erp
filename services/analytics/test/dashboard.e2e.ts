import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { bearer, OTHER_KEYS, resetState, token, unsigned, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false'; // estas pruebas no necesitan RabbitMQ
process.env.RATE_LIMIT = '100000';

describe('dashboard: authentication, roles and content (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const get = (p: string, auth?: string) => { const r = request(app.getHttpServer()).get(p); return auth ? r.set('Authorization', auth) : r; };
  const manager = () => bearer(token(USERS.manager));

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('bad tokens are rejected with 401', () => {
    const lead = USERS.lead;
    const bad: [string, string | undefined][] = [
      ['no token', undefined], ['empty bearer', 'Bearer '], ['basic scheme', 'Basic dXNlcjpwYXNz'], ['garbage', 'Bearer not.a.jwt'],
      ['expired', bearer(token(USERS.manager, { expiresIn: -60 }))],
      ['signed with another key', bearer(token(USERS.manager, { key: OTHER_KEYS.privateKey }))],
      ['wrong issuer', bearer(token(USERS.manager, { issuer: 'evil' }))],
      ['wrong audience', bearer(token(USERS.manager, { audience: 'other-api' }))],
      ['alg=none', bearer(unsigned(USERS.manager))],
      ['unknown role', bearer(token({ ...lead, role: 'admin' }))],
      ['payload tampered', (() => { const [h, , s] = token(USERS.sales).split('.'); const p = Buffer.from(JSON.stringify({ sub: 'x', email: 'a@b.co', role: 'manager', iss: 'identity-access', aud: 'erp-api', exp: 9999999999 })).toString('base64url'); return bearer(`${h}.${p}.${s}`); })()],
      ['HS256 with the public key', bearer(sign({ email: USERS.manager.email, role: 'manager' }, readFileSync('../../infra/keys/jwt-public.pem', 'utf8'), { algorithm: 'HS256', subject: USERS.manager.id, issuer: 'identity-access', audience: 'erp-api' }))],
    ];
    for (const [name, auth] of bad) it(name, async () => { expect((await get('/dashboard', auth)).status).toBe(401); });
  });

  describe('roles: only the manager sees financial figures', () => {
    it('the manager gets 200', async () => { expect((await get('/dashboard', manager())).status).toBe(200); });
    it.each([['project_lead', USERS.lead], ['billing_analyst', USERS.billing], ['sales', USERS.sales]])('%s gets 403 and no figure leaks', async (_n, u) => {
      const r = await get('/dashboard', bearer(token(u)));
      expect(r.status).toBe(403);
      expect(r.body).toEqual(expect.objectContaining({ statusCode: 403, correlationId: expect.any(String) }));
      expect(Object.keys(r.body).sort()).toEqual(['correlationId', 'error', 'message', 'statusCode']); // sin totals, projects ni actividad
      expect(JSON.stringify(r.body)).not.toMatch(/Branch|Retail|totals|projects|Cop/);
    });
    it('the role cannot be raised with a header or the query string', async () => {
      const r = await get('/dashboard?role=manager', bearer(token(USERS.sales))).set('x-role', 'manager');
      expect(r.status).toBe(403);
    });
  });

  describe('content', () => {
    it('starts from the demo read model (milestones m1 and m4, both issued)', async () => {
      const d = (await get('/dashboard', manager())).body;
      expect(d.totals).toEqual({ milestonesPending: { count: 0, cop: 0 }, overdue: { count: 0, totalCop: 0 }, collected: { totalCop: 0, paidInvoices: 0 }, milestonesApproved: 2, approvedCop: 21_800_000, waitingForInvoice: { count: 0, cop: 0 }, draft: { count: 0, totalCop: 0 }, issued: { count: 2, subtotalCop: 21_800_000, taxCop: 4_142_000, totalCop: 25_942_000 } });
      expect(d.projects.map((p: any) => p.projectName)).toEqual(['Branch network upgrade', 'Retail POS integration']);
      expect(d.freshness).toEqual({ lastEventAt: null, lastEventLagMs: null, eventsProcessed: 0 });
      expect(d.recentActivity).toEqual([]);
      expect(Date.parse(d.asOf)).not.toBeNaN();
    });
    it('exposes only the documented fields', async () => {
      const d = (await get('/dashboard', manager())).body;
      expect(Object.keys(d).sort()).toEqual(['asOf', 'freshness', 'projects', 'recentActivity', 'totals']);
      expect(Object.keys(d.projects[0]).sort()).toEqual(['approvedCop', 'draftTotalCop', 'issuedTotalCop', 'milestonesApproved', 'milestonesPending', 'overdueInvoices', 'projectName', 'waitingForInvoice']);
    });
    it('reflects a fact written to the read model', async () => {
      await prisma.milestoneFact.create({ data: { milestoneId: 'm9', projectId: 'p1', projectName: 'Branch network upgrade', milestoneName: 'X', amountCop: 1000, approvedBy: 'laura.rios@nexus.example', approvedAt: new Date() } });
      const d = (await get('/dashboard', manager())).body;
      expect(d.totals.milestonesApproved).toBe(3); expect(d.totals.waitingForInvoice).toEqual({ count: 1, cop: 1000 });
    });
    it('PERFORMANCE: p95 of 200 sequential queries stays far below the 3 s target', async () => {
      const ms: number[] = [];
      for (let i = 0; i < 200; i++) { const t = process.hrtime.bigint(); await get('/dashboard', manager()); ms.push(Number(process.hrtime.bigint() - t) / 1e6); }
      ms.sort((a, b) => a - b);
      const p95 = ms[Math.floor(ms.length * 0.95)];
      console.log(`dashboard query: p50 ${ms[100].toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · max ${ms[199].toFixed(1)} ms (200 requests, 2 facts)`);
      expect(p95).toBeLessThan(3000);
    });
  });

  it('keeps health public and sets security headers', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
