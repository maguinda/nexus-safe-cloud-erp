import { PrismaClient } from '@prisma/client';
import { InvalidEventError } from '../domain/errors';
import { AllocationFact, parseAllocationRemoved, parseEngineerAllocated } from '../domain/profitability';

export type AllocationResult = 'applied' | 'duplicate';
const TX = { timeout: 10_000, maxWait: 10_000 };

/**
 * Guarda y olvida asignaciones (EngineerAllocated / AllocationRemoved). La clave es la asignación (un aviso repetido no hace nada) y los dos avisos de UNA
 * misma asignación toman el mismo candado (advisory lock por id); el de «quitada» deja una marca, así que en cualquier orden la quitada no reaparece.
 */
export function allocationEventHandler(prisma: PrismaClient) {
  return async (raw: unknown): Promise<AllocationResult> => {
    const type = typeof raw === 'object' && raw !== null ? (raw as { type?: unknown }).type : undefined;
    if (type === 'EngineerAllocated') {
      const a = parseEngineerAllocated(raw);
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.allocationId}))`;
        if ((await tx.$queryRaw<unknown[]>`SELECT 1 FROM removed_allocation_marks WHERE allocation_id = ${a.allocationId}::uuid`).length) return 'duplicate';
        const n = await tx.$executeRaw`
          INSERT INTO allocation_facts (allocation_id, project_name, engineer_name, percent, period_start, period_end, daily_cost_cop, occurred_at)
          VALUES (${a.allocationId}::uuid, ${a.projectName}, ${a.engineerName}, ${a.percent}, ${a.periodStart}::date, ${a.periodEnd}::date, ${a.dailyCostCop}, ${a.occurredAt})
          ON CONFLICT (allocation_id) DO NOTHING`;
        return n === 1 ? 'applied' : 'duplicate';
      }, TX);
    }
    if (type === 'AllocationRemoved') {
      const { allocationId } = parseAllocationRemoved(raw);
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${allocationId}))`;
        const del = await tx.$executeRaw`DELETE FROM allocation_facts WHERE allocation_id = ${allocationId}::uuid`;
        const mark = await tx.$executeRaw`INSERT INTO removed_allocation_marks (allocation_id) VALUES (${allocationId}::uuid) ON CONFLICT (allocation_id) DO NOTHING`;
        return del === 1 || mark === 1 ? 'applied' : 'duplicate';
      }, TX);
    }
    throw new InvalidEventError('unexpected type');
  };
}

export async function allocationFacts(prisma: PrismaClient): Promise<AllocationFact[]> {
  const rows = await prisma.allocationFact.findMany({ orderBy: [{ projectName: 'asc' }, { allocationId: 'asc' }], take: 5000 });
  return rows.map((r) => ({ allocationId: r.allocationId, projectName: r.projectName, engineerName: r.engineerName, percent: r.percent, periodStart: r.periodStart.toISOString().slice(0, 10), periodEnd: r.periodEnd.toISOString().slice(0, 10), dailyCostCop: r.dailyCostCop, occurredAt: r.occurredAt }));
}
