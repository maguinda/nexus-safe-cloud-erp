import { PrismaClient } from '@prisma/client';
import { InvalidEventError } from '../domain/errors';
import { parseAllocationRemoved, parseEngineerAllocated } from '../domain/team';

/**
 * Mantiene el equipo del proyecto con dos avisos de Technical Capacity: EngineerAllocated (agrega) y AllocationRemoved (quita).
 * La clave es la asignación, así que un aviso repetido no hace nada. Los dos avisos de UNA misma asignación toman el mismo candado de la base
 * (advisory lock por id) y el de «quitada» deja una marca: da igual en qué orden lleguen, la asignación quitada nunca reaparece.
 */
export function teamEventHandler(prisma: PrismaClient) {
  return async (body: unknown): Promise<string> => {
    const type = typeof body === 'object' && body !== null ? (body as { type?: unknown }).type : undefined;
    if (type === 'EngineerAllocated') {
      const m = parseEngineerAllocated(body);
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${m.allocationId}))`;
        const gone = await tx.$queryRaw<unknown[]>`SELECT 1 FROM removed_allocations WHERE allocation_id = ${m.allocationId}::uuid`;
        if (gone.length) return 'ignored (already removed)';
        const n = await tx.$executeRaw`
          INSERT INTO project_team (allocation_id, engineer_name, project_name, percent, period_start, period_end, occurred_at)
          VALUES (${m.allocationId}::uuid, ${m.engineerName}, ${m.projectName}, ${m.percent}, ${m.periodStart}::date, ${m.periodEnd}::date, ${m.occurredAt})
          ON CONFLICT (allocation_id) DO NOTHING`;
        return n === 1 ? 'stored' : 'duplicate';
      }, { timeout: 10_000, maxWait: 10_000 });
    }
    if (type === 'AllocationRemoved') {
      const { allocationId } = parseAllocationRemoved(body);
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${allocationId}))`;
        const del = await tx.$executeRaw`DELETE FROM project_team WHERE allocation_id = ${allocationId}::uuid`;
        const mark = await tx.$executeRaw`INSERT INTO removed_allocations (allocation_id) VALUES (${allocationId}::uuid) ON CONFLICT (allocation_id) DO NOTHING`;
        return del === 1 ? 'removed' : mark === 1 ? 'marked' : 'duplicate';
      }, { timeout: 10_000, maxWait: 10_000 });
    }
    throw new InvalidEventError('unexpected type');
  };
}
