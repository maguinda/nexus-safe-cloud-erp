import { Prisma, PrismaClient } from '@prisma/client';
import { Allocation } from '../domain/allocation';
import { dayNumber, MS_DAY } from '../domain/dates';
import { Engineer } from '../domain/engineer';
import { CapacityEvent, routingKeyOf } from '../domain/events';
import { TransactionScope, UnitOfWork } from '../domain/ports';

export const dayDate = (n: number): Date => new Date(n * MS_DAY);
export const dateDay = (d: Date): number => Math.round(d.getTime() / MS_DAY);

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) => work(new PrismaTransactionScope(client)), { timeout: 10_000, maxWait: 10_000 });
  }
}

class PrismaTransactionScope implements TransactionScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async lockEngineer(id: string): Promise<Engineer | null> {
    // FOR UPDATE: otra asignación al MISMO ingeniero espera aquí y, al continuar, ya ve la carga que dejó la primera.
    const rows = await this.tx.$queryRaw<{ id: string; name: string; role: string; position: Engineer['position']; kind: Engineer['kind']; skills: string[]; certifications: string[]; monthlySalaryCop: number | null; dailyCostCop: number | null }[]>`
      SELECT id, name, role, position, kind, skills, certifications, monthly_salary_cop AS "monthlySalaryCop", daily_cost_cop AS "dailyCostCop" FROM engineers WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  async allocationsOverlapping(engineerId: string, from: number, to: number): Promise<Allocation[]> {
    const rows = await this.tx.$queryRaw<{ id: string; project_name: string; percent: number; start_date: Date; end_date: Date }[]>`
      SELECT id, project_name, percent, start_date, end_date FROM allocations
      WHERE engineer_id = ${engineerId}::uuid AND start_date <= ${dayDate(to)}::date AND end_date >= ${dayDate(from)}::date`;
    return rows.map((r) => ({ id: r.id, engineerId, projectName: r.project_name, percent: r.percent, start: dateDay(r.start_date), end: dateDay(r.end_date) }));
  }

  async insertAllocation(a: Allocation, overAllocated: boolean): Promise<void> {
    await this.tx.allocation.create({ data: { id: a.id, engineerId: a.engineerId, projectName: a.projectName, percent: a.percent, startDate: dayDate(a.start), endDate: dayDate(a.end), overAllocated } });
  }

  async deleteAllocation(id: string): Promise<{ projectName: string } | null> {
    const rows = await this.tx.$queryRaw<{ project_name: string }[]>`DELETE FROM allocations WHERE id = ${id}::uuid RETURNING project_name`;
    return rows[0] ? { projectName: rows[0].project_name } : null;
  }

  async addToOutbox(event: CapacityEvent, aggregateId: string): Promise<void> {
    await this.tx.outboxEvent.create({ data: { id: event.eventId, aggregateId, type: event.type, routingKey: routingKeyOf(event), payload: event as unknown as Prisma.InputJsonValue } });
  }
}
