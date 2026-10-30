import { PrismaClient } from '@prisma/client';
import { AuditEntry, parseAudit } from '../domain/audit';

/** Guarda una fila de bitácora por evento; el mismo evento dos veces no cambia nada (la clave es el eventId). */
export function auditEventHandler(prisma: PrismaClient) {
  return async (raw: unknown): Promise<'applied' | 'duplicate'> => {
    const a: AuditEntry = parseAudit(raw);
    const n = await prisma.$executeRaw`
      INSERT INTO audit_entries (event_id, type, occurred_at, actor, summary, correlation_id)
      VALUES (${a.eventId}::uuid, ${a.type}, ${a.occurredAt}, ${a.actor}, ${a.summary}, ${a.correlationId})
      ON CONFLICT (event_id) DO NOTHING`;
    return n === 1 ? 'applied' : 'duplicate';
  };
}

export interface AuditRow { eventId: string; type: string; occurredAt: string; actor: string | null; summary: string }
export async function listAudit(prisma: PrismaClient, opts: { type?: string; limit: number }): Promise<{ entries: AuditRow[]; types: string[] }> {
  const rows = await prisma.auditEntry.findMany({ where: opts.type ? { type: opts.type } : {}, orderBy: [{ occurredAt: 'desc' }, { eventId: 'asc' }], take: opts.limit });
  const types = (await prisma.auditEntry.findMany({ distinct: ['type'], select: { type: true }, orderBy: { type: 'asc' }, take: 100 })).map((t) => t.type);
  return { entries: rows.map((r) => ({ eventId: r.eventId, type: r.type, occurredAt: r.occurredAt.toISOString(), actor: r.actor, summary: r.summary })), types };
}
