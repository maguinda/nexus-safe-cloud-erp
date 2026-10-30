import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.RELAY_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

describe('quotes: from the sales offer to the approved project (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const call = (method: 'get' | 'post' | 'put', path: string, who?: { id: string; email: string; role: string }, body?: unknown) => {
    let r = (request(app.getHttpServer()) as any)[method](path);
    if (who) r = r.set('Authorization', bearer(token(who)));
    return body === undefined ? r : r.send(body);
  };
  const S = USERS.sales, M = USERS.manager;
  const content = (o: object = {}) => ({
    client: 'Acme S.A.S.', projectName: 'Red sede Bogotá', marginPct: 25,
    milestones: [
      { name: 'Diseño', lines: [{ category: 'labor', description: 'Ingeniero de redes', quantity: 5, unitCostCop: 227_273, ref: 'position:network_engineer' }, { category: 'supplies', description: 'Patch cords', quantity: 10, unitCostCop: 3_333 }] },
      { name: 'Instalación', lines: [{ category: 'materials', description: 'Switch de acceso 24 puertos', quantity: 3, unitCostCop: 2_000_001, ref: 'proc:switch' }, { category: 'labor', description: 'Técnico de campo', quantity: 4, unitCostCop: 109_091 }] },
    ], ...o,
  });
  const start = async (who = S) => (await call('post', '/quotes', who, { client: 'Acme S.A.S.', projectName: 'Red sede Bogotá' })).body as any;
  const ready = async (who = S, c: object = content()) => { const q = await start(who); const r = await call('put', `/quotes/${q.id}`, who, c); expect(r.status).toBe(200); return r.body as any; };
  const pending = async () => { const q = await ready(); expect((await call('post', `/quotes/${q.id}/submit`, S)).status).toBe(200); return q.id as string; };
  // Costo esperado: 5×227.273 + 10×3.333 = 1.169.695 ; 3×2.000.001 + 4×109.091 = 6.436.367 ; precios con 25 %.
  const COST1 = 1_136_365 + 33_330, COST2 = 6_000_003 + 436_364;
  const price = (c: number) => Math.floor((c * 125 * 2 + 100) / 200);

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  it('roles: sales and manager start and edit; billing and the project lead do not; reading is for sales (own), manager and project lead; no token is 401', async () => {
    expect((await call('post', '/quotes', S, { client: 'Acme', projectName: 'Proyecto' })).status).toBe(201);
    expect((await call('post', '/quotes', M, { client: 'Acme', projectName: 'Proyecto' })).status).toBe(201);
    for (const u of [USERS.billing, USERS.lead]) expect((await call('post', '/quotes', u, { client: 'Acme', projectName: 'Proyecto' })).status).toBe(403);
    expect((await call('post', '/quotes', undefined, { client: 'Acme', projectName: 'Proyecto' })).status).toBe(401);
    for (const u of [S, M, USERS.lead]) expect((await call('get', '/quotes', u)).status).toBe(200);
    expect((await call('get', '/quotes', USERS.billing)).status).toBe(403);
    expect((await call('get', '/quotes', undefined)).status).toBe(401);
    expect((await call('get', '/quotes', S)).body).toHaveLength(1); // ventas solo ve las suyas
    expect((await call('get', '/quotes', USERS.lead)).body).toHaveLength(2);
    expect((await call('get', '/quotes', USERS.sales2)).body).toHaveLength(0);
  });

  it('starts as a draft with a 25 % margin, and nothing from the body can set the status, the owner or the number', async () => {
    for (const extra of [{ status: 'approved' }, { createdBy: 'x@y.z' }, { number: 99 }, { marginPct: 1 }, { projectId: 'p1' }]) expect((await call('post', '/quotes', S, { client: 'Acme', projectName: 'Proyecto', ...extra })).status).toBe(400);
    expect(await prisma.quote.count()).toBe(0);
    const r = await call('post', '/quotes', S, { client: 'Acme', projectName: 'Proyecto' });
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ status: 'draft', marginPct: 25, createdBy: S.email, number: expect.stringMatching(/^COT-\d{4}$/), costCop: 0, priceCop: 0, milestones: [] });
    for (const bad of [{}, { client: '', projectName: 'P' }, { client: 'Acme', projectName: '<b>x</b>' }, { client: 5, projectName: 'P' }]) expect((await call('post', '/quotes', S, bad)).status).toBe(400);
  });

  it('computes cost, price and profit from the lines: milestone prices add up exactly to the quote price', async () => {
    const q = await ready();
    expect(q.milestones.map((m: any) => [m.costCop, m.priceCop])).toEqual([[COST1, price(COST1)], [COST2, price(COST2)]]);
    expect(q).toMatchObject({ costCop: COST1 + COST2, priceCop: price(COST1) + price(COST2), profitCop: price(COST1) + price(COST2) - COST1 - COST2, lowMargin: false, byCategory: { materials: 6_000_003, supplies: 33_330, labor: 1_136_365 + 436_364 } });
    const low = (await call('put', `/quotes/${q.id}`, S, content({ marginPct: 5 }))).body; expect(low.lowMargin).toBe(true);
    expect((await call('put', `/quotes/${q.id}`, S, content({ marginPct: 0 }))).body.priceCop).toBe(COST1 + COST2);
  });

  it('rejects bad content with 400 and leaves the stored quote untouched', async () => {
    const q = await ready(); const before = (await call('get', `/quotes/${q.id}`, S)).body;
    const bads = [{ marginPct: 101 }, { marginPct: -1 }, { marginPct: '25' }, { client: '' }, { milestones: 'x' },
      { milestones: [{ name: 'A', lines: [{ category: 'beer', description: 'x1', quantity: 1, unitCostCop: 5 }] }] },
      { milestones: [{ name: 'A', lines: [{ category: 'labor', description: 'x1', quantity: 0, unitCostCop: 5 }] }] },
      { milestones: [{ name: 'A', lines: [{ category: 'labor', description: 'x1', quantity: 1, unitCostCop: 1_000_000_001 }] }] },
      { milestones: [{ name: 'A', lines: [] }, { name: 'a', lines: [] }] },
      { milestones: [{ name: 'A', lines: [{ category: 'materials', description: 'x1', quantity: 1000, unitCostCop: 1_000_000 }] }] }];
    for (const b of bads) expect((await call('put', `/quotes/${q.id}`, S, content(b))).status).toBe(400);
    expect((await call('get', `/quotes/${q.id}`, S)).body).toEqual(before);
    expect(await prisma.quoteMilestone.count({ where: { quoteId: q.id } })).toBe(2);
  });

  it('ownership: another salesperson gets 403 on read, edit and send; the manager may touch any; unknown id 404, bad id 400', async () => {
    const q = await ready();
    for (const [m, p, b] of [['get', `/quotes/${q.id}`, undefined], ['put', `/quotes/${q.id}`, content()], ['post', `/quotes/${q.id}/submit`, undefined]] as const) expect((await call(m, p, USERS.sales2, b)).status).toBe(403);
    expect((await call('put', `/quotes/${q.id}`, M, content({ marginPct: 30 }))).body.marginPct).toBe(30);
    expect((await call('get', `/quotes/${randomUUID()}`, S)).status).toBe(404); expect((await call('get', '/quotes/zz', S)).status).toBe(400);
    expect((await call('put', `/quotes/${randomUUID()}`, S, content())).status).toBe(404);
  });

  it('sending needs a milestone and a line in each; only a draft can be sent; a pending quote cannot be edited', async () => {
    const empty = await start(); expect((await call('post', `/quotes/${empty.id}/submit`, S)).status).toBe(409);
    await call('put', `/quotes/${empty.id}`, S, content({ milestones: [{ name: 'Sin líneas', lines: [] }] })); expect((await call('post', `/quotes/${empty.id}/submit`, S)).status).toBe(409);
    const id = await pending(); expect((await call('get', `/quotes/${id}`, S)).body.status).toBe('pending');
    expect((await call('post', `/quotes/${id}/submit`, S)).status).toBe(409); expect((await call('put', `/quotes/${id}`, S, content())).status).toBe(409);
  });

  it('approving (manager only) creates the project with one milestone per quote milestone at its price, publishes MilestoneCreated and QuoteApproved in the same transaction, and links the quote to the project', async () => {
    const id = await pending();
    for (const u of [S, USERS.lead, USERS.billing]) expect((await call('post', `/quotes/${id}/approve`, u)).status).toBe(403);
    expect((await call('post', `/quotes/${id}/approve`, undefined)).status).toBe(401);
    expect((await call('get', `/quotes/${id}`, S)).body.status).toBe('pending');
    const r = await call('post', `/quotes/${id}/approve`, M); expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'approved', decidedBy: M.email, projectId: expect.stringMatching(/^p-/) });
    const p = await prisma.project.findUniqueOrThrow({ where: { id: r.body.projectId }, include: { milestones: true } });
    expect(p).toMatchObject({ name: 'Red sede Bogotá', client: 'Acme S.A.S.' });
    expect(p.milestones.map((m) => [m.name, m.amountCop, m.status]).sort()).toEqual([['Diseño', price(COST1), 'pending'], ['Instalación', price(COST2), 'pending']]);
    expect(p.milestones.reduce((s, m) => s + m.amountCop, 0)).toBe(r.body.priceCop);
    const ev = await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(ev.filter((e) => e.type === 'MilestoneCreated')).toHaveLength(2);
    const qa = ev.find((e) => e.type === 'QuoteApproved')!; expect(qa.routingKey).toBe('project.quote.approved'); expect(qa.aggregateId).toBe(id);
    expect((qa.payload as any).data).toEqual({ quoteId: id, quoteNumber: r.body.number, clientName: 'Acme S.A.S.', projectId: r.body.projectId, projectName: 'Red sede Bogotá', amountCop: r.body.priceCop, costCop: COST1 + COST2, marginPct: 25, approvedBy: M.email });
    // Final: ni aprobar de nuevo, ni rechazar, ni editar, ni reenviar.
    expect((await call('post', `/quotes/${id}/approve`, M)).status).toBe(409); expect((await call('post', `/quotes/${id}/reject`, M, { note: 'tarde' })).status).toBe(409);
    expect((await call('put', `/quotes/${id}`, S, content())).status).toBe(409); expect((await call('post', `/quotes/${id}/submit`, S)).status).toBe(409);
    expect(await prisma.project.count({ where: { id: { startsWith: 'p-' } } })).toBe(1);
  });

  it('rejecting needs a reason; sales can fix a rejected quote (it goes back to draft) and send it again', async () => {
    const id = await pending();
    for (const bad of [{}, { note: '' }, { note: 'ab' }, { note: '<b>x</b> no' }, { note: 'x'.repeat(301) }, { note: 5 }]) expect((await call('post', `/quotes/${id}/reject`, M, bad)).status).toBeGreaterThanOrEqual(400);
    expect((await call('post', `/quotes/${id}/reject`, S, { note: 'No me toca' })).status).toBe(403);
    expect((await call('get', `/quotes/${id}`, S)).body.status).toBe('pending');
    const r = await call('post', `/quotes/${id}/reject`, M, { note: 'El margen es muy bajo para este alcance' });
    expect(r.body).toMatchObject({ status: 'rejected', decisionNote: 'El margen es muy bajo para este alcance', decidedBy: M.email });
    expect((await call('post', `/quotes/${id}/approve`, M)).status).toBe(409); expect((await call('post', `/quotes/${id}/submit`, S)).status).toBe(409);
    const fixed = await call('put', `/quotes/${id}`, S, content({ marginPct: 40 })); expect(fixed.body).toMatchObject({ status: 'draft', marginPct: 40, decisionNote: null, decidedBy: null });
    expect((await call('post', `/quotes/${id}/submit`, S)).status).toBe(200); expect((await call('post', `/quotes/${id}/approve`, M)).status).toBe(200);
    expect(await prisma.project.count({ where: { id: { startsWith: 'p-' } } })).toBe(1);
  });

  it('CONCURRENCY: 20 rounds of 8 simultaneous approvals → exactly one wins, one project, one QuoteApproved, one MilestoneCreated per milestone', async () => {
    for (let r = 0; r < 20; r++) {
      await resetState(prisma); const id = await pending();
      const res = await Promise.all(Array.from({ length: 8 }, () => call('post', `/quotes/${id}/approve`, M)));
      expect(res.filter((x) => x.status === 200)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
      expect(await prisma.project.count({ where: { id: { startsWith: 'p-' } } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { type: 'QuoteApproved' } })).toBe(1); expect(await prisma.outboxEvent.count({ where: { type: 'MilestoneCreated' } })).toBe(2);
    }
  }, 180_000);

  it('CONCURRENCY: approving and rejecting at once → one decision only', async () => {
    for (let r = 0; r < 20; r++) {
      await resetState(prisma); const id = await pending();
      const res = await Promise.all([call('post', `/quotes/${id}/approve`, M), call('post', `/quotes/${id}/reject`, M, { note: 'No procede' }), call('post', `/quotes/${id}/approve`, M), call('post', `/quotes/${id}/reject`, M, { note: 'No procede' })]);
      expect(res.filter((x) => x.status === 200)).toHaveLength(1);
      const q = await prisma.quote.findUniqueOrThrow({ where: { id } });
      expect(await prisma.project.count({ where: { id: { startsWith: 'p-' } } })).toBe(q.status === 'approved' ? 1 : 0);
      expect(await prisma.outboxEvent.count({ where: { type: 'QuoteApproved' } })).toBe(q.status === 'approved' ? 1 : 0);
    }
  }, 180_000);

  it('CONCURRENCY: editing while the manager approves → the project always carries exactly what the quote finally says, and a late edit is refused', async () => {
    for (let r = 0; r < 20; r++) {
      await resetState(prisma); const id = await pending();
      // La edición solo es posible en borrador: con la cotización pendiente se rechaza siempre, gane quien gane; lo aprobado es lo que se vio.
      const res = await Promise.all([call('post', `/quotes/${id}/approve`, M), call('put', `/quotes/${id}`, S, content({ marginPct: 90 })), call('put', `/quotes/${id}`, M, content({ marginPct: 80 }))]);
      expect(res[0].status).toBe(200); expect(res[1].status).toBe(409); expect(res[2].status).toBe(409);
      const q = (await call('get', `/quotes/${id}`, M)).body;
      expect(q.marginPct).toBe(25);
      const p = await prisma.project.findUniqueOrThrow({ where: { id: q.projectId }, include: { milestones: true } });
      expect(p.milestones.reduce((s, m) => s + m.amountCop, 0)).toBe(q.priceCop);
    }
  }, 180_000);

  it('CONCURRENCY: sending the same draft 8 times at once → it goes pending once and the rest are refused', async () => {
    for (let r = 0; r < 10; r++) {
      await resetState(prisma); const q = await ready();
      const res = await Promise.all(Array.from({ length: 8 }, () => call('post', `/quotes/${q.id}/submit`, S)));
      expect(res.filter((x) => x.status === 200)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
    }
  }, 120_000);

  it('the database refuses an approved quote without project, a project on a draft, a rejection without reason, a bad margin or status, and lines outside the limits', async () => {
    const q = await start();
    for (const sql of [`UPDATE quotes SET status = 'approved' WHERE id = '${q.id}'`, `UPDATE quotes SET project_id = 'p-x' WHERE id = '${q.id}'`, `UPDATE quotes SET status = 'rejected', decided_by = 'a', decided_at = now() WHERE id = '${q.id}'`,
      `UPDATE quotes SET margin_pct = 101 WHERE id = '${q.id}'`, `UPDATE quotes SET status = 'lost' WHERE id = '${q.id}'`]) await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
    const m = await prisma.quoteMilestone.create({ data: { quoteId: q.id, position: 1, name: 'H' } });
    for (const bad of [{ category: 'beer', quantity: 1, unit: 5 }, { category: 'labor', quantity: 0, unit: 5 }, { category: 'labor', quantity: 1, unit: 0 }]) {
      await expect(prisma.$executeRawUnsafe(`INSERT INTO quote_lines (milestone_id, position, category, description, quantity, unit_cost_cop) VALUES ('${m.id}', 1, '${bad.category}', 'desc', ${bad.quantity}, ${bad.unit})`)).rejects.toThrow();
    }
  });
});
