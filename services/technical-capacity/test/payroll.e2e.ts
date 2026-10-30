import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { employerCost } from '../src/domain/engineer';
import { bearer, resetState, token, USERS } from './helpers';

process.env.RELAY_ENABLED = 'false';
process.env.CONSUMER_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

describe('monthly payroll (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const M = USERS.manager, F = USERS.finance;
  const call = (m: 'get' | 'post', p: string, who?: any, body?: object) => { let r = (request(app.getHttpServer()) as any)[m](p); if (who) r = r.set('Authorization', bearer(token(who))); return body ? r.send(body) : r; };
  const generate = (period: unknown, who: any = M) => call('post', '/payroll', who, { period });
  const detail = async (id: string) => (await call('get', `/payroll/${id}`, M)).body;
  const person = async (name: string, position: string, salary: number) => { const id = (await call('post', '/engineers', M, { name, position, monthlySalaryCop: salary })).body.id as string; return id; };

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  it('only the manager and finance (401 without token, 403 for the others)', async () => {
    for (const u of [M, F]) { expect((await call('get', '/payroll', u)).status).toBe(200); }
    for (const u of [USERS.lead, USERS.sales, USERS.billing]) { expect((await call('get', '/payroll', u)).status).toBe(403); expect((await generate('2026-03', u)).status).toBe(403); expect((await call('post', `/payroll/${randomUUID()}/pay`, u)).status).toBe(403); }
    expect((await call('get', '/payroll')).status).toBe(401); expect((await call('post', '/payroll', undefined, { period: '2026-03' })).status).toBe(401);
    expect(await prisma.payrollRun.count()).toBe(0);
  });

  it('generating takes a snapshot of everyone with a salary: each line is what the person costs the company, and the total is the exact sum', async () => {
    const lonely = (await call('post', '/engineers', M, { name: 'Sin Sueldo', position: 'tech_lead' })).body.id; // sin sueldo: no entra
    const t = await person('Técnico Nuevo', 'field_technician', 2_400_000);
    const r = await generate('2026-03', F); expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ period: '2026-03', status: 'generated', headcount: 9, generatedBy: F.email, paidAt: null });
    const d = await detail(r.body.id); expect(d.lines).toHaveLength(9);
    expect(d.lines.find((l: any) => l.engineerId === lonely)).toBeUndefined();
    const tech = d.lines.find((l: any) => l.engineerId === t);
    expect(tech).toMatchObject({ name: 'Técnico Nuevo', position: 'field_technician', kind: 'technician', ...Object.fromEntries(Object.entries({ salaryCop: employerCost(2_400_000, 'field_technician').salaryCop, transportAidCop: 249_095, employerCostCop: 3_768_045 })) });
    for (const l of d.lines) { const c = employerCost(l.salaryCop, l.position); expect(l.employerCostCop).toBe(c.monthlyCop); expect(l.prestacionesCop).toBe(c.prestacionesCop); expect(l.arlCop).toBe(c.arlCop); }
    expect(d.totalCop).toBe(d.lines.reduce((s: number, l: any) => s + l.employerCostCop, 0));
  });

  it('a later salary change does not touch a payroll already generated (it is a snapshot)', async () => {
    const id = await person('Cambia Sueldo', 'software_engineer', 5_000_000);
    const r = (await generate('2026-04')).body;
    await call('post', '/engineers', M, { name: 'otro', position: 'tech_lead' });
    await (request(app.getHttpServer()) as any).patch(`/engineers/${id}/salary`).set('Authorization', bearer(token(M))).send({ monthlySalaryCop: 9_000_000 });
    const line = (await detail(r.id)).lines.find((l: any) => l.engineerId === id);
    expect(line.salaryCop).toBe(5_000_000); expect(line.employerCostCop).toBe(employerCost(5_000_000, 'software_engineer').monthlyCop);
  });

  it('refuses bad periods (400), a month that already has a payroll (409) and an empty payroll (400)', async () => {
    for (const bad of [undefined, null, '', '2026-13', '2026-00', '2026-1', '26-03', '2026/03', '2025-12', '2031-01', '2026-12', 202603, { a: 1 }, '2026-03 ', "2026-03'; DROP TABLE payroll_runs"]) expect((await generate(bad)).status).toBe(400);
    expect((await generate('2026-05')).status).toBe(201); expect((await generate('2026-05', F)).status).toBe(409);
    expect((await generate('2026-11')).status).toBe(201); // el mes siguiente al actual sí se puede
    expect(await prisma.payrollRun.count()).toBe(2);
    const saved = await prisma.engineer.findMany({ select: { id: true, monthlySalaryCop: true, position: true } });
    await prisma.$executeRawUnsafe('UPDATE engineers SET daily_cost_cop = NULL, monthly_salary_cop = NULL');
    try { expect((await generate('2026-06')).status).toBe(400); } finally { for (const e of saved) await prisma.$executeRawUnsafe(`UPDATE engineers SET monthly_salary_cop = ${e.monthlySalaryCop ?? 'NULL'}, daily_cost_cop = ${e.monthlySalaryCop ? `employer_daily_cost(${e.monthlySalaryCop}, '${e.position}')` : 'NULL'} WHERE id = '${e.id}'`); }
    expect(await prisma.payrollRun.count()).toBe(2);
  });

  it('paying marks it paid ONCE, tells the bus (PayrollPaid) and a second payment is 409; unknown id 404, bad id 400', async () => {
    const run = (await generate('2026-07')).body;
    const p = await call('post', `/payroll/${run.id}/pay`, F); expect(p.status).toBe(200); expect(p.body).toMatchObject({ status: 'paid', paidBy: F.email, paidAt: expect.any(String) });
    expect((await call('post', `/payroll/${run.id}/pay`, M)).status).toBe(409);
    const ev = await prisma.outboxEvent.findMany({ where: { type: 'PayrollPaid' } }); expect(ev).toHaveLength(1);
    expect(ev[0].routingKey).toBe('capacity.payroll.paid'); expect((ev[0].payload as any).data).toEqual({ payrollId: run.id, period: '2026-07', totalCop: run.totalCop, headcount: run.headcount, paidBy: F.email });
    expect((await call('post', `/payroll/${randomUUID()}/pay`, M)).status).toBe(404); expect((await call('post', '/payroll/zz/pay', M)).status).toBe(400);
    expect((await call('get', `/payroll/${randomUUID()}`, M)).status).toBe(404); expect((await call('get', '/payroll/zz', M)).status).toBe(400);
    expect((await call('get', '/payroll', M)).body.map((x: any) => x.period)).toEqual(['2026-07']);
  });

  it('the database keeps the payroll: lines cannot be changed or deleted, a run cannot be deleted, edited, un-paid or paid twice', async () => {
    const run = (await generate('2026-08')).body;
    for (const sql of [`UPDATE payroll_lines SET salary_cop = 1 WHERE run_id = '${run.id}'`, `DELETE FROM payroll_lines WHERE run_id = '${run.id}'`, `DELETE FROM payroll_runs WHERE id = '${run.id}'`, `UPDATE payroll_runs SET total_cop = 1 WHERE id = '${run.id}'`, `UPDATE payroll_runs SET status = 'paid' WHERE id = '${run.id}'`]) await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
    await call('post', `/payroll/${run.id}/pay`, M);
    for (const sql of [`UPDATE payroll_runs SET status = 'generated', paid_by = NULL, paid_at = NULL WHERE id = '${run.id}'`, `UPDATE payroll_runs SET paid_by = 'otra@x.co' WHERE id = '${run.id}'`]) await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO payroll_runs (period, total_cop, headcount, generated_by) VALUES ('2026-8', 1, 1, 'x')`)).rejects.toThrow();
  });

  it('CONCURRENCY: 8 simultaneous «generate» of the same month → one run, 7 conflicts, 9 lines', async () => {
    for (let r = 0; r < 15; r++) {
      await resetState(prisma);
      const res = await Promise.all(Array.from({ length: 8 }, (_, k) => generate('2026-09', k % 2 ? M : F)));
      expect(res.filter((x) => x.status === 201)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
      expect(await prisma.payrollRun.count()).toBe(1); expect(await prisma.payrollLine.count()).toBe(8);
    }
  }, 120_000);

  it('CONCURRENCY: 8 simultaneous payments → paid once, one event', async () => {
    for (let r = 0; r < 15; r++) {
      await resetState(prisma); await prisma.outboxEvent.deleteMany();
      const run = (await generate('2026-10')).body;
      const res = await Promise.all(Array.from({ length: 8 }, (_, k) => call('post', `/payroll/${run.id}/pay`, k % 2 ? M : F)));
      expect(res.filter((x) => x.status === 200)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
      expect(await prisma.outboxEvent.count({ where: { type: 'PayrollPaid' } })).toBe(1);
    }
  }, 120_000);

  it('CONCURRENCY: generating while salaries change → the run is always self-consistent (its total is the sum of its lines, each line is a real cost of its salary)', async () => {
    const id = await person('Cambiante', 'tech_lead', 10_000_000);
    for (let r = 0; r < 15; r++) {
      await prisma.payrollLine.deleteMany().catch(() => undefined); await prisma.$executeRawUnsafe('TRUNCATE payroll_lines, payroll_runs');
      const res = await Promise.all([generate('2026-06'), (request(app.getHttpServer()) as any).patch(`/engineers/${id}/salary`).set('Authorization', bearer(token(M))).send({ monthlySalaryCop: 10_000_000 + r * 1000 })]);
      expect(res[0].status).toBe(201);
      const d = await detail(res[0].body.id);
      expect(d.totalCop).toBe(d.lines.reduce((s: number, l: any) => s + l.employerCostCop, 0));
      for (const l of d.lines) expect(l.employerCostCop).toBe(employerCost(l.salaryCop, l.position).monthlyCop);
    }
  }, 120_000);
});
