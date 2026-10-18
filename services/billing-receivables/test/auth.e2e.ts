import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { bearer, OTHER_KEYS, resetState, token, unsigned, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false'; // estas pruebas no necesitan RabbitMQ
process.env.RATE_LIMIT = '100000';

describe('invoices: authentication, roles and issuing (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const get = (p: string, auth?: string) => { const r = request(app.getHttpServer()).get(p); return auth ? r.set('Authorization', auth) : r; };
  const patch = (p: string, auth?: string) => { const r = request(app.getHttpServer()).patch(p); return auth ? r.set('Authorization', auth) : r; };
  const addDraft = (number: string, milestoneId: string) => prisma.invoice.create({ data: { number, milestoneId, projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', amountCop: 18_500_000, taxCop: 3_515_000, totalCop: 22_015_000, status: 'draft' } });

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('bad tokens are rejected with 401 on both routes', () => {
    const lead = USERS.lead;
    const bad: [string, string | undefined][] = [
      ['no token', undefined], ['empty bearer', 'Bearer '], ['basic scheme', 'Basic dXNlcjpwYXNz'], ['garbage', 'Bearer not.a.jwt'],
      ['expired', bearer(token(lead, { expiresIn: -60 }))],
      ['signed with another key', bearer(token(lead, { key: OTHER_KEYS.privateKey }))],
      ['wrong issuer', bearer(token(lead, { issuer: 'evil' }))],
      ['wrong audience', bearer(token(lead, { audience: 'other-api' }))],
      ['alg=none', bearer(unsigned(lead))],
      ['unknown role', bearer(token({ ...lead, role: 'admin' }))],
      ['payload tampered', (() => { const [h, , s] = token(USERS.sales).split('.'); const p = Buffer.from(JSON.stringify({ sub: 'x', email: 'a@b.co', role: 'billing_analyst', iss: 'identity-access', aud: 'erp-api', exp: 9999999999 })).toString('base64url'); return bearer(`${h}.${p}.${s}`); })()],
      ['HS256 with the public key', bearer(sign({ email: lead.email, role: lead.role }, readFileSync('../../infra/keys/jwt-public.pem', 'utf8'), { algorithm: 'HS256', subject: lead.id, issuer: 'identity-access', audience: 'erp-api' }))],
    ];
    for (const [name, auth] of bad) {
      it(name, async () => {
        expect((await get('/invoices', auth)).status).toBe(401);
        expect((await patch('/invoices/INV-0103/issue', auth)).status).toBe(401);
      });
    }
    it('a rejected issue request changes nothing', async () => {
      await addDraft('INV-0103', 'm2');
      await patch('/invoices/INV-0103/issue', bearer(token(USERS.billing, { expiresIn: -60 })));
      expect((await prisma.invoice.findUnique({ where: { number: 'INV-0103' } }))?.status).toBe('draft');
    });
  });

  describe('roles', () => {
    it('project_lead and billing_analyst can list; sales gets 403', async () => {
      for (const u of [USERS.lead, USERS.billing]) expect((await get('/invoices', bearer(token(u)))).status).toBe(200);
      const res = await get('/invoices', bearer(token(USERS.sales)));
      expect(res.status).toBe(403);
      expect(res.body).toEqual(expect.objectContaining({ statusCode: 403, correlationId: expect.any(String) }));
      expect(JSON.stringify(res.body)).not.toMatch(/INV-/); // el 403 no deja ver ninguna factura
    });
    it('only billing_analyst can issue; others get 403 and the draft stays a draft', async () => {
      await addDraft('INV-0103', 'm2');
      for (const u of [USERS.lead, USERS.sales]) expect((await patch('/invoices/INV-0103/issue', bearer(token(u)))).status).toBe(403);
      expect((await prisma.invoice.findUnique({ where: { number: 'INV-0103' } }))?.status).toBe('draft');
    });
    it('the role cannot be raised with a header or the body', async () => {
      await addDraft('INV-0103', 'm2');
      const res = await patch('/invoices/INV-0103/issue', bearer(token(USERS.sales))).set('x-role', 'billing_analyst').send({ role: 'billing_analyst', issuedBy: 'andres.mora@nexus.example' });
      expect(res.status).toBe(403);
    });
  });

  describe('listing', () => {
    it('returns the seeded invoices, newest first, with only the contract fields', async () => {
      await addDraft('INV-0103', 'm2');
      const res = await get('/invoices', bearer(token(USERS.billing)));
      expect(res.body.map((i: any) => i.number)).toEqual(['INV-0103', 'INV-0102', 'INV-0101']);
      expect(Object.keys(res.body[0]).sort()).toEqual(['amountCop', 'createdAt', 'milestoneName', 'number', 'projectName', 'status', 'taxCop', 'totalCop']);
      expect(res.body[0].status).toBe('draft');
      expect(res.body[1]).toMatchObject({ number: 'INV-0102', status: 'issued', amountCop: 9_800_000, taxCop: 1_862_000, totalCop: 11_662_000 });
    });
  });

  describe('issuing', () => {
    it('issues a draft and records the issuer from the token', async () => {
      await addDraft('INV-0103', 'm2');
      const res = await patch('/invoices/INV-0103/issue', bearer(token(USERS.billing)));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('issued');
      const row = await prisma.invoice.findUnique({ where: { number: 'INV-0103' } });
      expect(row?.issuedBy).toBe(USERS.billing.email);
      expect(row?.issuedAt).not.toBeNull();
    });
    it('answers 409 for an invoice that is already issued', async () => {
      expect((await patch('/invoices/INV-0101/issue', bearer(token(USERS.billing)))).status).toBe(409);
    });
    it('answers 404 for an unknown invoice and 400 for hostile numbers', async () => {
      expect((await patch('/invoices/INV-9999/issue', bearer(token(USERS.billing)))).status).toBe(404);
      for (const bad of ['INV-1', "INV-0103';DROP TABLE invoices;--", '..%2F..%2Fetc', 'inv-0103', 'INV-' + '9'.repeat(30)]) {
        expect({ bad, status: (await patch(`/invoices/${bad}/issue`, bearer(token(USERS.billing)))).status }).toEqual({ bad, status: 400 });
      }
    });
    it('CONCURRENCY: 30 rounds of 15 simultaneous issues of one invoice -> exactly one wins', async () => {
      const analysts = Array.from({ length: 15 }, (_, i) => ({ ...USERS.billing, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, email: `analyst${i}@nexus.example` }));
      for (let round = 1; round <= 30; round++) {
        await resetState(prisma);
        await addDraft('INV-0103', 'm2');
        const res = await Promise.all(analysts.map((a) => patch('/invoices/INV-0103/issue', bearer(token(a)))));
        const codes = res.map((r) => r.status);
        if (codes.filter((c) => c === 200).length !== 1 || codes.filter((c) => c === 409).length !== 14) throw new Error(`round ${round}: ${JSON.stringify(codes)}`);
        const row = await prisma.invoice.findUnique({ where: { number: 'INV-0103' } });
        expect(row?.issuedBy).toBe(analysts[codes.indexOf(200)].email);
      }
    }, 120_000);
  });

  it('keeps health public and sets security headers', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
