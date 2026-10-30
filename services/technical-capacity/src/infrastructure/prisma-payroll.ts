import { Prisma, PrismaClient } from '@prisma/client';
import { employerCost, Position } from '../domain/engineer';
import { ValidationError } from '../domain/errors';
import { randomUUID } from 'crypto';

const TX = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000, maxWait: 10_000 } as const;
export class PayrollNotFoundError extends Error { constructor() { super('Payroll run not found'); } }
export class PayrollStateError extends Error {}
export const PAYROLL_PAID_ROUTING_KEY = 'capacity.payroll.paid';
export const MIN_PERIOD = '2026-01';

/** Periodo AAAA-MM real: de enero de 2026 hasta el mes siguiente al actual (no se genera la nómina de un futuro lejano). */
export function validatePeriod(v: unknown, now: Date): string {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new ValidationError('period must look like 2026-11');
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)); const max = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  if (v < MIN_PERIOD) throw new ValidationError(`period cannot be before ${MIN_PERIOD}`);
  if (v > max) throw new ValidationError(`period cannot be after ${max}`);
  return v;
}

const runView = (r: { id: string; period: string; status: string; totalCop: bigint; headcount: number; generatedBy: string; generatedAt: Date; paidBy: string | null; paidAt: Date | null }) => ({
  id: r.id, period: r.period, status: r.status as 'generated' | 'paid', totalCop: Number(r.totalCop), headcount: r.headcount, generatedBy: r.generatedBy, generatedAt: r.generatedAt.toISOString(), paidBy: r.paidBy, paidAt: r.paidAt?.toISOString() ?? null,
});

/**
 * Nómina mensual. Generar toma una FOTO de todas las personas con sueldo (FOR SHARE: un cambio de sueldo a la vez espera) y calcula el costo con la misma cuenta del costo diario;
 * el periodo es único, así que dos «generar» a la vez dan una sola corrida (la otra, 409). Pagar bloquea la corrida y la pasa de «generada» a «pagada» UNA vez, y avisa (PayrollPaid, outbox).
 */
export class PayrollService {
  constructor(private readonly prisma: PrismaClient, private readonly clock: () => Date = () => new Date()) {}

  async generate(periodRaw: unknown, actor: string) {
    const period = validatePeriod(periodRaw, this.clock());
    try {
      return await this.prisma.$transaction(async (tx) => {
        const people = await tx.$queryRaw<{ id: string; name: string; position: string; kind: string; salary: number }[]>`
          SELECT id, name, position, kind, monthly_salary_cop AS salary FROM engineers WHERE monthly_salary_cop IS NOT NULL ORDER BY name, id FOR SHARE`;
        if (people.length === 0) throw new ValidationError('Nobody has a salary yet: there is no payroll to generate');
        const lines = people.map((p) => ({ p, c: employerCost(p.salary, p.position as Position) }));
        const total = lines.reduce((s, l) => s + l.c.monthlyCop, 0);
        const run = await tx.payrollRun.create({ data: { period, totalCop: BigInt(total), headcount: lines.length, generatedBy: actor } });
        await tx.payrollLine.createMany({ data: lines.map(({ p, c }) => ({ id: randomUUID(), runId: run.id, engineerId: p.id, name: p.name, position: p.position, kind: p.kind, salaryCop: c.salaryCop, transportAidCop: c.transportAidCop, prestacionesCop: c.prestacionesCop, pensionCop: c.pensionCop, cajaCop: c.cajaCop, arlCop: c.arlCop, employerCostCop: c.monthlyCop })) });
        return runView(run);
      }, TX);
    } catch (e) {
      if (/payroll_runs_period_key|Unique constraint/i.test(String((e as Error)?.message)) || (e as { code?: string })?.code === 'P2002') throw new PayrollStateError(`The payroll of ${period} already exists`);
      throw e;
    }
  }

  async list() { return (await this.prisma.payrollRun.findMany({ orderBy: { period: 'desc' }, take: 60 })).map(runView); }

  async get(id: string) {
    const r = await this.prisma.payrollRun.findUnique({ where: { id }, include: { lines: { orderBy: [{ name: 'asc' }, { id: 'asc' }] } } });
    if (!r) throw new PayrollNotFoundError();
    return { ...runView(r), lines: r.lines.map((l) => ({ engineerId: l.engineerId, name: l.name, position: l.position, kind: l.kind, salaryCop: l.salaryCop, transportAidCop: l.transportAidCop, prestacionesCop: l.prestacionesCop, pensionCop: l.pensionCop, cajaCop: l.cajaCop, arlCop: l.arlCop, employerCostCop: l.employerCostCop })) };
  }

  /** Marca la corrida como pagada, una sola vez. */
  async pay(id: string, actor: string, correlationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM payroll_runs WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new PayrollNotFoundError();
      if (rows[0].status !== 'generated') throw new PayrollStateError('That payroll is already paid');
      const now = this.clock();
      const run = await tx.payrollRun.update({ where: { id }, data: { status: 'paid', paidBy: actor, paidAt: now } });
      const ev = { eventId: randomUUID(), type: 'PayrollPaid', occurredAt: now.toISOString(), correlationId, data: { payrollId: run.id, period: run.period, totalCop: Number(run.totalCop), headcount: run.headcount, paidBy: actor } };
      await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: run.id, type: ev.type, routingKey: PAYROLL_PAID_ROUTING_KEY, payload: ev as unknown as Prisma.InputJsonValue } });
      return runView(run);
    }, TX);
  }
}
