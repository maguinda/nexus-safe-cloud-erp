import { PrismaClient } from '@prisma/client';
import { parseEngineerAllocated } from '../domain/team';

/** Guarda al ingeniero en el equipo. La clave es la asignación: si el evento llega repetido, la segunda copia no hace nada. */
export function teamEventHandler(prisma: PrismaClient) {
  return async (body: unknown): Promise<string> => {
    const m = parseEngineerAllocated(body);
    const n = await prisma.$executeRaw`
      INSERT INTO project_team (allocation_id, engineer_name, project_name, percent, period_start, period_end, occurred_at)
      VALUES (${m.allocationId}::uuid, ${m.engineerName}, ${m.projectName}, ${m.percent}, ${m.periodStart}::date, ${m.periodEnd}::date, ${m.occurredAt})
      ON CONFLICT (allocation_id) DO NOTHING`;
    return n === 1 ? 'stored' : 'duplicate';
  };
}
