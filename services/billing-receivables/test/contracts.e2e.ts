import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false';
process.env.RELAY_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

describe('contracts: roles, rules, billed and paid by project (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const call = (m: 'get' | 'post' | 'patch', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', bearer(token(who))); return body ? r.send(body) : r; };
  const body = (o: object = {}) => ({ clientName: 'Retail Norte (example)', projectName: 'Branch network upgrade', amountCop: 120_000_000, startDate: '2026-11-01', endDate: '2027-05-01', ...o });

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  it('401 without token and 403 for sales (create, list and status)', async () => {
    expect((await call('get', '/contracts')).status).toBe(401);
    expect((await call('post', '/contracts', undefined, body())).status).toBe(401);
    expect((await call('post', '/contracts', USERS.sales, body())).status).toBe(403);
    expect((await call('get', '/contracts', USERS.sales)).status).toBe(403);
    expect((await call('post', '/contracts', USERS.lead, body())).status).toBe(403); // el líder lee, no crea
    expect((await call('patch', `/contracts/${randomUUID()}/status`, USERS.lead, { status: 'closed' })).status).toBe(403);
  });

  it('manager and billing analyst create; manager, analyst and lead list; the creator is not exposed', async () => {
    const a = await call('post', '/contracts', USERS.manager, body()); expect(a.status).toBe(201);
    const b = await call('post', '/contracts', USERS.billing, body({ clientName: 'Banco Andino (example)', projectName: 'Core migration' })); expect(b.status).toBe(201);
    for (const u of [USERS.manager, USERS.billing, USERS.lead]) {
      const l = await call('get', '/contracts', u); expect(l.status).toBe(200); expect(l.body).toHaveLength(2);
      expect(Object.keys(l.body[0]).sort()).toEqual(['amountCop', 'billedCop', 'clientName', 'createdAt', 'endDate', 'id', 'paidCop', 'projectName', 'startDate', 'status']);
    }
    expect(a.body.status).toBe('active'); expect(await prisma.contract.count()).toBe(2);
    expect((await prisma.contract.findUnique({ where: { id: a.body.id } }))!.createdBy).toBe(USERS.manager.email);
  });

  it.each<[string, object]>([
    ['amount 0', { amountCop: 0 }], ['decimal amount', { amountCop: 1.5 }], ['end before start', { endDate: '2026-10-01' }], ['impossible date', { startDate: '2026-02-30' }],
    ['markup in client', { clientName: '<script>x</script>' }], ['client too long', { clientName: 'x'.repeat(301) }], ['no project', { projectName: '' }], ['amount as text', { amountCop: '5' }],
  ])('400 and nothing saved: %s', async (_n, over) => {
    const r = await call('post', '/contracts', USERS.manager, body(over)); expect(r.status).toBe(400); expect(await prisma.contract.count()).toBe(0);
  });

  it('billed = issued invoices of the same project (without VAT) and paid = their payments; drafts do not count', async () => {
    const c = await call('post', '/contracts', USERS.manager, body({ projectName: 'Contract test project' }));
    await call('post', '/contracts', USERS.manager, body({ projectName: 'Other project' }));
    await prisma.invoice.create({ data: { number: 'INV-0701', milestoneId: 'ct1', projectName: 'Contract test project', milestoneName: 'M1', amountCop: 1_000_000, taxCop: 190_000, totalCop: 1_190_000, status: 'issued', issuedAt: new Date(), issuedBy: 'andres.mora@nexus.example', dueDate: new Date('2026-12-30T15:00:00Z') } as any });
    await prisma.invoice.create({ data: { number: 'INV-0702', milestoneId: 'ct2', projectName: 'Contract test project', milestoneName: 'M2', amountCop: 500_000, taxCop: 95_000, totalCop: 595_000, status: 'draft' } as any });
    expect((await call('post', '/invoices/INV-0701/payments', USERS.billing, { amountCop: 400_000, method: 'cash' })).status).toBe(201);
    const l = (await call('get', '/contracts', USERS.manager)).body;
    const mine = l.find((x: any) => x.id === c.body.id), other = l.find((x: any) => x.projectName === 'Other project');
    expect(mine).toMatchObject({ billedCop: 1_000_000, paidCop: 400_000 }); expect(other).toMatchObject({ billedCop: 0, paidCop: 0 });
  });

  it('only an active contract can be closed or cancelled; 404 for an unknown id; 400 for a bad id or status', async () => {
    const c = (await call('post', '/contracts', USERS.manager, body())).body.id;
    expect((await call('patch', `/contracts/${c}/status`, USERS.manager, { status: 'active' })).status).toBe(409);
    expect((await call('patch', `/contracts/${c}/status`, USERS.manager, { status: 'bogus' })).status).toBe(409);
    expect((await call('patch', '/contracts/not-a-uuid/status', USERS.manager, { status: 'closed' })).status).toBe(400);
    expect((await call('patch', `/contracts/${randomUUID()}/status`, USERS.manager, { status: 'closed' })).status).toBe(404);
    expect((await call('patch', `/contracts/${c}/status`, USERS.billing, { status: 'closed' })).status).toBe(200);
    expect((await call('patch', `/contracts/${c}/status`, USERS.manager, { status: 'cancelled' })).status).toBe(409); // ya cerrado
    expect((await prisma.contract.findUnique({ where: { id: c } }))!.status).toBe('closed');
  });

  it('CONCURRENCY: 30 rounds of a close and a cancel at once: exactly one wins and the final state is the winner', async () => {
    for (let r = 0; r < 30; r++) {
      const id = (await call('post', '/contracts', USERS.manager, body())).body.id;
      const res = await Promise.all([call('patch', `/contracts/${id}/status`, USERS.manager, { status: 'closed' }), call('patch', `/contracts/${id}/status`, USERS.billing, { status: 'cancelled' })]);
      const wins = res.filter((x) => x.status === 200); expect(wins).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(1);
      expect((await prisma.contract.findUnique({ where: { id } }))!.status).toBe(wins[0].body.status);
    }
  });

  it('the database refuses an invalid contract by itself (CHECK)', async () => {
    const bad = (sql: string) => prisma.$executeRawUnsafe(sql);
    await expect(bad(`INSERT INTO contracts (client_name, project_name, amount_cop, start_date, end_date, created_by) VALUES ('Ab','Cd',0,'2026-11-01','2026-12-01','x')`)).rejects.toThrow();
    await expect(bad(`INSERT INTO contracts (client_name, project_name, amount_cop, start_date, end_date, created_by) VALUES ('Ab','Cd',5,'2026-12-01','2026-11-01','x')`)).rejects.toThrow();
    await expect(bad(`INSERT INTO contracts (client_name, project_name, amount_cop, start_date, end_date, status, created_by) VALUES ('Ab','Cd',5,'2026-11-01','2026-12-01','weird','x')`)).rejects.toThrow();
  });
});
