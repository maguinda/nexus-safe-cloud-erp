import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, OTHER_KEYS, resetState, SEED_ENGINEERS, token, unsigned, USERS } from './helpers';

process.env.RELAY_ENABLED = 'false'; // el relé se prueba aparte; aquí se mira el outbox
process.env.CONSUMER_ENABLED = 'false'; // sin RabbitMQ en esta prueba
process.env.RATE_LIMIT = '100000';

describe('capacity: authentication, roles, the 100% rule and events (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const as = (u: any) => bearer(token(u));
  const call = (m: 'get' | 'post' | 'delete' | 'patch', p: string, auth?: string, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (auth) r = r.set('Authorization', auth); return body ? r.send(body) : r; };
  const newEngineer = async (name = 'Test Engineer') => (await call('post', '/engineers', as(USERS.manager), { name, role: 'Tester', position: 'software_engineer', skills: ['Jest'], certifications: [] })).body.id as string;
  const alloc = (id: string, percent: number, s: string, e: string, who: any = USERS.lead, extra: object = {}) => call('post', `/engineers/${id}/allocations`, as(who), { projectName: 'Branch network upgrade', percent, startDate: s, endDate: e, ...extra });
  const outbox = () => prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('bad tokens are rejected with 401', () => {
    const bad: [string, string | undefined][] = [
      ['no token', undefined], ['garbage', 'Bearer not.a.jwt'], ['expired', bearer(token(USERS.manager, { expiresIn: -60 }))], ['wrong audience', bearer(token(USERS.manager, { audience: 'x' }))],
      ['wrong issuer', bearer(token(USERS.manager, { issuer: 'evil' }))], ['another key', bearer(token(USERS.manager, { key: OTHER_KEYS.privateKey }))], ['alg none', bearer(unsigned(USERS.manager))],
    ];
    it.each(bad)('%s', async (_n, auth) => {
      for (const [m, p] of [['get', '/engineers'], ['post', '/engineers'], ['post', `/engineers/${randomUUID()}/allocations`], ['delete', `/allocations/${randomUUID()}`]] as const) expect((await call(m, p, auth)).status).toBe(401);
    });
  });

  it('roles: sales, lead and manager read; billing does not; only the manager creates engineers; lead and manager allocate; sales cannot', async () => {
    for (const who of [USERS.sales, USERS.lead, USERS.manager]) expect((await call('get', '/engineers', as(who))).status).toBe(200);
    expect((await call('get', '/engineers', as(USERS.billing))).status).toBe(403);
    const body = { name: 'Nueva Persona', role: 'Dev', position: 'software_engineer' };
    for (const who of [USERS.lead, USERS.sales, USERS.billing]) expect((await call('post', '/engineers', as(who), body)).status).toBe(403);
    const id = await newEngineer();
    expect((await alloc(id, 10, '2026-11-02', '2026-11-03', USERS.sales)).status).toBe(403);
    expect((await alloc(id, 10, '2026-11-02', '2026-11-03', USERS.billing)).status).toBe(403);
    expect((await alloc(id, 10, '2026-11-02', '2026-11-03', USERS.lead)).status).toBe(201);
    expect((await alloc(id, 10, '2026-11-02', '2026-11-03', USERS.manager)).status).toBe(201);
    expect((await call('delete', `/allocations/${randomUUID()}`, as(USERS.sales))).status).toBe(403);
  });

  it('the seed gives the six demo engineers and the two technicians, with their load', async () => {
    const r = await call('get', '/engineers', as(USERS.sales));
    expect(r.body.engineers.filter((e: any) => SEED_ENGINEERS.includes(e.id))).toHaveLength(8);
    expect(r.body.engineers.filter((e: any) => e.kind === 'technician' && SEED_ENGINEERS.includes(e.id)).map((e: any) => e.position).sort()).toEqual(['field_technician', 'support_technician']);
    const ana = r.body.engineers.find((e: any) => e.name === 'Ana Torres');
    expect(ana).toMatchObject({ skills: ['Cisco', 'SD-WAN', 'Terraform'], certifications: ['CCNP'] });
    expect(ana.loadToday).toBeGreaterThanOrEqual(60); expect(ana.freeToday).toBe(100 - ana.loadToday);
    expect(Object.keys(ana).sort()).toEqual(['allocations', 'certifications', 'freeToday', 'id', 'kind', 'loadToday', 'minFreeNext30', 'name', 'peakNext30', 'position', 'role', 'skills']);
  });

  it('the salary is monthly: only the manager writes and sees it; the daily cost is derived (salary / 22) and travels in the allocation event as the value in force at that moment', async () => {
    const mk = await call('post', '/engineers', as(USERS.manager), { name: 'Costed Engineer', position: 'network_engineer', monthlySalaryCop: 9_900_000 });
    expect(mk.status).toBe(201); const id = mk.body.id as string;
    expect(mk.body).toMatchObject({ position: 'network_engineer', kind: 'engineer', role: 'Network engineer', monthlySalaryCop: 9_900_000, dailyCostCop: 622_584 });
    const list = async (u: any) => (await call('get', '/engineers', as(u))).body.engineers.find((x: any) => x.id === id);
    expect(await list(USERS.manager)).toMatchObject({ monthlySalaryCop: 9_900_000, dailyCostCop: 622_584, position: 'network_engineer', kind: 'engineer' });
    for (const u of [USERS.lead, USERS.sales]) { const p = await list(u); expect(p).not.toHaveProperty('dailyCostCop'); expect(p).not.toHaveProperty('monthlySalaryCop'); expect(p).toMatchObject({ position: 'network_engineer', kind: 'engineer' }); }
    await alloc(id, 50, '2026-11-02', '2026-11-30');
    expect((await call('patch', `/engineers/${id}/salary`, as(USERS.lead), { monthlySalaryCop: 1 })).status).toBe(403);
    expect((await call('patch', `/engineers/${id}/salary`, as(USERS.sales), { monthlySalaryCop: 1 })).status).toBe(403);
    expect((await call('patch', `/engineers/${id}/salary`, as(USERS.manager), { monthlySalaryCop: 13_200_000 })).status).toBe(204);
    expect(await list(USERS.manager)).toMatchObject({ monthlySalaryCop: 13_200_000, dailyCostCop: 830_112 });
    await alloc(id, 10, '2026-12-01', '2026-12-10');
    const ev = (await outbox()).filter((e) => e.type === 'EngineerAllocated').map((e: any) => e.payload.data.dailyCostCop);
    expect(ev).toEqual([622584, 830112]); // la primera asignación conserva el costo que había
    expect((await call('patch', `/engineers/${id}/salary`, as(USERS.manager), { monthlySalaryCop: null })).status).toBe(204);
    expect(await list(USERS.manager)).toMatchObject({ monthlySalaryCop: null, dailyCostCop: null });
    for (const bad of [0, -5, 1.5, '300', 200_000_001]) expect((await call('patch', `/engineers/${id}/salary`, as(USERS.manager), { monthlySalaryCop: bad })).status).toBe(400);
    expect((await call('patch', `/engineers/${id}/cost`, as(USERS.manager), { dailyCostCop: 5 })).status).toBe(404); // la ruta vieja ya no existe
    expect((await call('patch', `/engineers/${randomUUID()}/salary`, as(USERS.manager), { monthlySalaryCop: 5 })).status).toBe(404);
    expect((await call('post', '/engineers', as(USERS.manager), { name: 'Bad Salary', position: 'tech_lead', monthlySalaryCop: -1 })).status).toBe(400);
    // La base misma defiende las reglas: un costo que no sale del sueldo, un sueldo fuera de rango, un cargo inventado y un tipo que no corresponde al cargo.
    for (const sql of [`UPDATE engineers SET daily_cost_cop = 0 WHERE id = '${id}'`, `UPDATE engineers SET monthly_salary_cop = 1000000, daily_cost_cop = 7 WHERE id = '${id}'`, `UPDATE engineers SET monthly_salary_cop = 0, daily_cost_cop = 0 WHERE id = '${id}'`, `UPDATE engineers SET daily_cost_cop = 5 WHERE id = '${id}'`, `UPDATE engineers SET position = 'ceo' WHERE id = '${id}'`, `UPDATE engineers SET kind = 'technician' WHERE id = '${id}'`, `UPDATE engineers SET position = 'field_technician' WHERE id = '${id}'`]) await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
  });

  it('the positions: seven fixed ones; the kind comes from the position; technicians are staff too and can be allocated', async () => {
    const mk = async (position: string, extra: object = {}) => call('post', '/engineers', as(USERS.manager), { name: `Staff ${position}`, position, ...extra });
    for (const [pos, kind] of [['software_engineer', 'engineer'], ['cloud_devops_engineer', 'engineer'], ['security_engineer', 'engineer'], ['network_engineer', 'engineer'], ['tech_lead', 'engineer'], ['field_technician', 'technician'], ['support_technician', 'technician']] as const) {
      const r = await mk(pos); expect(r.status).toBe(201); expect(r.body).toMatchObject({ position: pos, kind });
    }
    const t = await mk('field_technician', { role: 'Instalador de fibra' }); expect(t.body.role).toBe('Instalador de fibra');
    expect((await alloc(t.body.id, 40, '2026-11-02', '2026-11-30')).status).toBe(201);
    for (const bad of [undefined, '', 'engineer', 'technician', 'ceo', 'toString', '__proto__', 5, null]) expect((await mk(bad as any)).status).toBe(400);
    expect((await call('post', '/engineers', as(USERS.manager), { name: 'Sin cargo', role: 'Dev' })).status).toBe(400);
    expect((await call('post', '/engineers', as(USERS.manager), { name: 'Forzado', position: 'field_technician', kind: 'engineer' })).status).toBe(400); // kind no se acepta del cliente
  });

  it('deleting an allocation publishes AllocationRemoved in the same transaction; deleting what does not exist publishes nothing', async () => {
    const id = await newEngineer();
    const a = await alloc(id, 30, '2026-11-02', '2026-11-30');
    expect((await call('delete', `/allocations/${a.body.id}`, as(USERS.lead))).status).toBe(204);
    const ev = (await outbox()).filter((e) => e.type === 'AllocationRemoved');
    expect(ev).toHaveLength(1); expect(ev[0]).toMatchObject({ aggregateId: a.body.id, routingKey: 'capacity.allocation.removed' });
    expect((ev[0].payload as any).data).toEqual({ allocationId: a.body.id, projectName: 'Branch network upgrade' });
    expect((await call('delete', `/allocations/${a.body.id}`, as(USERS.lead))).status).toBe(404);
    expect((await outbox()).filter((e) => e.type === 'AllocationRemoved')).toHaveLength(1);
  });

  it('creates an engineer and shows them with no load; rejects strange input with 400', async () => {
    const id = await newEngineer('Persona Nueva');
    const e = (await call('get', '/engineers', as(USERS.manager))).body.engineers.find((x: any) => x.id === id);
    expect(e).toMatchObject({ loadToday: 0, freeToday: 100, peakNext30: 0, allocations: [] });
    for (const b of [{}, { name: 'A', role: 'Dev' }, { name: 'Ana', role: 'Dev', extra: 1 }, { name: '<b>x</b>', role: 'Dev' }, { name: 'Ana Torres', role: 'Dev', skills: 'Cisco' }, { name: 'Ana Torres', role: 'Dev', skills: Array(21).fill('abc') }])
      expect((await call('post', '/engineers', as(USERS.manager), b)).status).toBe(400);
  });

  it('the 100% rule: up to exactly 100 is fine, one more percent on any overlapping day is a 409 that names the peak and leaves nothing', async () => {
    const id = await newEngineer();
    expect((await alloc(id, 60, '2026-11-02', '2026-11-20')).status).toBe(201);
    expect((await alloc(id, 40, '2026-11-10', '2026-11-30')).status).toBe(201);
    const r = await alloc(id, 1, '2026-11-15', '2026-11-16');
    expect(r.status).toBe(409); expect(r.body.message).toContain('101%');
    expect((await alloc(id, 100, '2026-12-01', '2026-12-31')).status).toBe(201); // otro período
    expect(await prisma.allocation.count({ where: { engineerId: id } })).toBe(3);
    expect((await outbox()).filter((e) => e.type === 'OverAllocationDetected')).toHaveLength(0);
  });

  it('bad allocations: 400 for percent, dates and names; 404 for an unknown or malformed engineer', async () => {
    const id = await newEngineer();
    const bad = [[0, '2026-11-02', '2026-11-03'], [101, '2026-11-02', '2026-11-03'], [50, '2026-11-05', '2026-11-03'], [50, '2026-02-30', '2026-03-03'], [50, '2026-01-01', '2029-06-01'], [50.5, '2026-11-02', '2026-11-03']] as const;
    for (const [p, s, e] of bad) expect((await alloc(id, p, s, e)).status).toBe(400);
    expect((await call('post', `/engineers/${id}/allocations`, as(USERS.lead), { projectName: '<x>', percent: 10, startDate: '2026-11-02', endDate: '2026-11-03' })).status).toBe(400);
    expect((await call('post', `/engineers/${id}/allocations`, as(USERS.lead), { projectName: 'Project', percent: 10, startDate: '2026-11-02', endDate: '2026-11-03', hack: true })).status).toBe(400);
    expect((await alloc(randomUUID(), 10, '2026-11-02', '2026-11-03')).status).toBe(404);
    expect((await alloc('not-a-uuid', 10, '2026-11-02', '2026-11-03')).status).toBe(400);
    expect(await prisma.allocation.count({ where: { engineerId: id } })).toBe(0);
  });

  it('the override: only the manager may allow going over 100; it is stored as such and announced with the peak', async () => {
    const id = await newEngineer('Ana Sobrecargada');
    await alloc(id, 80, '2026-11-02', '2026-11-30');
    expect((await alloc(id, 50, '2026-11-10', '2026-11-12', USERS.lead, { allowOverallocation: true })).status).toBe(403);
    expect((await alloc(id, 50, '2026-11-10', '2026-11-12', USERS.lead)).status).toBe(409);
    const ok = await alloc(id, 50, '2026-11-10', '2026-11-12', USERS.manager, { allowOverallocation: true });
    expect(ok.status).toBe(201); expect(ok.body).toMatchObject({ overAllocated: true, peak: 130 });
    const ev = (await outbox()).find((e) => e.type === 'OverAllocationDetected')!;
    expect(ev.routingKey).toBe('capacity.overallocation.detected');
    expect((ev.payload as any).data).toMatchObject({ engineerName: 'Ana Sobrecargada', allocationPercent: 130, periodStart: '2026-11-10', periodEnd: '2026-11-12' });
    expect(await prisma.allocation.count({ where: { engineerId: id, overAllocated: true } })).toBe(1);
  });

  it('every accepted allocation writes EngineerAllocated to the outbox in the same transaction; the unique key stops a second event of the same type', async () => {
    const id = await newEngineer();
    const r = await alloc(id, 30, '2026-11-02', '2026-11-30');
    const ev = (await outbox()).filter((e) => e.type === 'EngineerAllocated');
    expect(ev).toHaveLength(1); expect(ev[0]).toMatchObject({ aggregateId: r.body.id, routingKey: 'capacity.engineer.allocated' });
    await expect(prisma.outboxEvent.create({ data: { id: randomUUID(), aggregateId: r.body.id, type: 'EngineerAllocated', routingKey: 'x', payload: {} } })).rejects.toBeTruthy();
  });

  it('deleting frees the capacity again; deleting twice or an unknown id is 404', async () => {
    const id = await newEngineer();
    const a = await alloc(id, 100, '2026-11-02', '2026-11-30');
    expect((await alloc(id, 10, '2026-11-05', '2026-11-06')).status).toBe(409);
    expect((await call('delete', `/allocations/${a.body.id}`, as(USERS.lead))).status).toBe(204);
    expect((await alloc(id, 10, '2026-11-05', '2026-11-06')).status).toBe(201);
    expect((await call('delete', `/allocations/${a.body.id}`, as(USERS.lead))).status).toBe(404);
    expect((await call('delete', `/allocations/${randomUUID()}`, as(USERS.lead))).status).toBe(404);
    expect((await call('delete', '/allocations/xyz', as(USERS.lead))).status).toBe(400);
  });

  it('CONCURRENCY: 30 rounds of 8 simultaneous 20% allocations on the same days → exactly 5 win, the rest get 409, and the load never goes over 100', async () => {
    for (let round = 0; round < 30; round++) {
      const id = await newEngineer(`Race ${round}`);
      const res = await Promise.all(Array.from({ length: 8 }, () => alloc(id, 20, '2026-11-02', '2026-11-30', round % 2 ? USERS.lead : USERS.manager)));
      const codes = res.map((r) => r.status);
      expect(codes.filter((c) => c === 201)).toHaveLength(5);
      expect(codes.filter((c) => c === 409)).toHaveLength(3);
      expect(codes.filter((c) => c !== 201 && c !== 409)).toEqual([]);
      const rows = await prisma.allocation.findMany({ where: { engineerId: id } });
      expect(rows.reduce((s, x) => s + x.percent, 0)).toBe(100);
    }
  }, 120_000);

  it('CONCURRENCY with partial overlaps: whatever order they land, no day exceeds 100', async () => {
    for (let round = 0; round < 15; round++) {
      const id = await newEngineer(`Overlap ${round}`);
      const periods: [number, string, string][] = [[50, '2026-11-02', '2026-11-12'], [50, '2026-11-10', '2026-11-20'], [50, '2026-11-18', '2026-11-28'], [60, '2026-11-05', '2026-11-25'], [30, '2026-11-01', '2026-11-30']];
      await Promise.all(periods.map(([p, s, e]) => alloc(id, p, s, e)));
      const rows = await prisma.allocation.findMany({ where: { engineerId: id } });
      for (let day = 1; day <= 30; day++) {
        const t = Date.UTC(2026, 10, day);
        expect(rows.filter((r) => r.startDate.getTime() <= t && r.endDate.getTime() >= t).reduce((s, r) => s + r.percent, 0)).toBeLessThanOrEqual(100);
      }
    }
  }, 120_000);

  it('allocations of different engineers never block each other (the lock is per engineer)', async () => {
    const [a, b] = [await newEngineer('Uno'), await newEngineer('Dos')];
    const res = await Promise.all([alloc(a, 100, '2026-11-02', '2026-11-30'), alloc(b, 100, '2026-11-02', '2026-11-30')]);
    expect(res.map((r) => r.status)).toEqual([201, 201]);
  });

  it('past allocations do not show in the list, but still count for overlapping past periods', async () => {
    const id = await newEngineer();
    await alloc(id, 100, '2025-01-01', '2025-01-31');
    expect((await alloc(id, 10, '2025-01-15', '2025-01-16')).status).toBe(409);
    const e = (await call('get', '/engineers', as(USERS.manager))).body.engineers.find((x: any) => x.id === id);
    expect(e.allocations).toEqual([]);
  });

  it('reference salaries per position: the seven estimates from the market search, readable by sales, manager and project lead (not billing); only the manager adjusts them; the daily cost is salary / 22', async () => {
    const list = (u: any) => call('get', '/position-rates', as(u));
    for (const u of [USERS.sales, USERS.lead, USERS.manager]) expect((await list(u)).status).toBe(200);
    expect((await list(USERS.billing)).status).toBe(403); expect((await call('get', '/position-rates')).status).toBe(401);
    const r = (await list(USERS.sales)).body as any[];
    expect(r.map((x) => x.position)).toEqual(['software_engineer', 'cloud_devops_engineer', 'security_engineer', 'network_engineer', 'tech_lead', 'field_technician', 'support_technician']);
    expect(r.find((x) => x.position === 'network_engineer')).toMatchObject({ kind: 'engineer', monthlySalaryCop: 5_000_000, dailyCostCop: 314_436 });
    expect(r.find((x) => x.position === 'field_technician')).toMatchObject({ kind: 'technician', monthlySalaryCop: 2_400_000, dailyCostCop: 171_275 });
    for (const x of r) { expect(x.note.length).toBeGreaterThan(10); expect(x.monthlySalaryCop).toBeGreaterThan(1_750_905); } // ninguno por debajo del mínimo legal
    for (const u of [USERS.lead, USERS.sales, USERS.billing]) expect((await call('patch', '/position-rates/tech_lead', as(u), { monthlySalaryCop: 1 })).status).toBe(403);
    expect((await call('patch', '/position-rates/tech_lead', as(USERS.manager), { monthlySalaryCop: 11_000_000, note: 'Ajustado por gerencia' })).status).toBe(204);
    expect((await list(USERS.sales)).body.find((x: any) => x.position === 'tech_lead')).toMatchObject({ monthlySalaryCop: 11_000_000, dailyCostCop: 691_760, note: 'Ajustado por gerencia', updatedBy: USERS.manager.email });
    for (const bad of [{}, { monthlySalaryCop: 0 }, { monthlySalaryCop: 1.5 }, { monthlySalaryCop: '9' }, { monthlySalaryCop: 200_000_001 }, { monthlySalaryCop: 5, note: 'x' }, { monthlySalaryCop: 5, note: '<b>nota</b>' }]) expect((await call('patch', '/position-rates/tech_lead', as(USERS.manager), bad)).status).toBe(400);
    for (const bad of ['ceo', 'toString', '__proto__']) expect((await call('patch', `/position-rates/${bad}`, as(USERS.manager), { monthlySalaryCop: 5_000_000 })).status).toBe(404);
    expect((await list(USERS.sales)).body.find((x: any) => x.position === 'tech_lead').monthlySalaryCop).toBe(11_000_000);
    await prisma.$executeRawUnsafe(`UPDATE position_rates SET monthly_salary_cop = 10000000, note = 'Estimado oct-2026 (restaurado por la prueba)' WHERE position = 'tech_lead'`);
    await expect(prisma.$executeRawUnsafe(`UPDATE position_rates SET monthly_salary_cop = 0 WHERE position = 'tech_lead'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO position_rates (position, monthly_salary_cop, note) VALUES ('ceo', 5000000, 'inventado')`)).rejects.toThrow();
  });

  it('the cost with benefits: the SQL function the database checks and the TypeScript breakdown agree on 400 salary and position pairs, including every edge of the transport aid', async () => {
    const { employerCost, POSITIONS } = require('../src/domain/engineer');
    const positions = Object.keys(POSITIONS);
    const salaries = [1, 22, 1_750_905, 3_501_809, 3_501_810, 3_501_811, 10_000_000, 200_000_000, ...Array.from({ length: 392 }, (_, i) => 1 + ((i * 7_919_113 + 12345) % 200_000_000))];
    for (const [i, s] of salaries.entries()) {
      const pos = positions[i % positions.length];
      const sql = (await prisma.$queryRawUnsafe<{ d: number }[]>(`SELECT employer_daily_cost(${s}, '${pos}') AS d`))[0].d;
      if (sql !== employerCost(s, pos).dailyCop) throw new Error(`SQL and TypeScript disagree for ${s} ${pos}: ${sql} vs ${employerCost(s, pos).dailyCop}`);
    }
  });

  it('the database refuses a daily cost that is not the cost of the salary and position (the old «salary / 22» is no longer valid)', async () => {
    const id = await newEngineer('Costo Banco'); await call('patch', `/engineers/${id}/salary`, as(USERS.manager), { monthlySalaryCop: 5_000_000 });
    await expect(prisma.$executeRawUnsafe(`UPDATE engineers SET daily_cost_cop = 227273 WHERE id = '${id}'`)).rejects.toThrow();
    await prisma.$executeRawUnsafe(`UPDATE engineers SET daily_cost_cop = 314436 WHERE id = '${id}'`);
  });

  it('my capacity: an engineer or a technician sees only their own load and allocations, never a salary or a cost; the other roles use the general list (403 here)', async () => {
    const eng = { id: randomUUID(), email: 'ana.torres@nexus.example', role: 'engineer' };
    const tok = (u: any, staffId?: string) => bearer(token(u, staffId ? { extra: { staffId } } : {}));
    const get = (auth?: string) => { let r = request(app.getHttpServer()).get('/my-capacity'); if (auth) r = r.set('Authorization', auth); return r; };
    const ana = SEED_ENGINEERS[0];
    const r = await get(tok(eng, ana)); expect(r.status).toBe(200);
    expect(r.body.me).toMatchObject({ id: ana, name: 'Ana Torres', kind: 'engineer' }); expect(r.body.me.allocations.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(/dailyCostCop|monthlySalaryCop/);
    const hugo = await get(tok({ id: randomUUID(), email: 'hugo.salazar@nexus.example', role: 'technician' }, SEED_ENGINEERS[6])); expect(hugo.body.me.name).toBe('Hugo Salazar');
    expect((await get(tok(eng, randomUUID()))).status).toBe(404);
    for (const u of [USERS.manager, USERS.lead, USERS.sales, USERS.billing, USERS.finance]) expect((await get(tok(u))).status).toBe(403);
    expect((await get()).status).toBe(401); expect((await get(tok(eng))).status).toBe(401);
  });

  it('the technicians list (to assign milestone activities): only technicians, no salary or cost; engineer, project lead and manager can read it, the others cannot', async () => {
    const tok = (u: any, staffId?: string) => bearer(token(u, staffId ? { extra: { staffId } } : {}));
    const get = (auth?: string) => { let r = request(app.getHttpServer()).get('/staff/technicians'); if (auth) r = r.set('Authorization', auth); return r; };
    const eng = { id: randomUUID(), email: 'ana.torres@nexus.example', role: 'engineer' };
    for (const who of [tok(eng, SEED_ENGINEERS[0]), as(USERS.lead), as(USERS.manager)]) {
      const r = await get(who); expect(r.status).toBe(200);
      const names = r.body.technicians.map((t: any) => t.name).sort();
      expect(names).toEqual(['Hugo Salazar', 'Nelly Ortiz']); // solo técnicos: ningún ingeniero
      expect(r.body.technicians[0]).toEqual(expect.objectContaining({ id: expect.any(String), position: expect.any(String), loadToday: expect.any(Number), freeToday: expect.any(Number) }));
      expect(JSON.stringify(r.body)).not.toMatch(/dailyCostCop|monthlySalaryCop|salary|cost/i);
    }
    for (const u of [USERS.sales, USERS.billing, USERS.finance]) expect((await get(as(u))).status).toBe(403);
    expect((await get(tok({ id: randomUUID(), email: 'hugo.salazar@nexus.example', role: 'technician' }, SEED_ENGINEERS[6]))).status).toBe(403); // el técnico no arma listas de otros
    expect((await get()).status).toBe(401);
  });
});
