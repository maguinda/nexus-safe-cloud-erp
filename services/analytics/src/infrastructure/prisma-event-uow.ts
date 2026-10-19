import { Prisma, PrismaClient } from '@prisma/client';
import { AnalyticsEvent } from '../domain/events';
import { Fact } from '../domain/fact';
import { EventScope, EventUnitOfWork } from '../domain/ports';

const TX = { timeout: 10_000, maxWait: 10_000 };

export class PrismaEventUnitOfWork implements EventUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: EventScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new PrismaEventScope(c)), TX);
  }
}

const toFact = (r: any): Fact => ({
  milestoneId: r.milestoneId, projectId: r.projectId, projectName: r.projectName, milestoneName: r.milestoneName, amountCop: r.amountCop,
  approvedBy: r.approvedBy, approvedAt: r.approvedAt, invoiceNumber: r.invoiceNumber, invoiceStatus: r.invoiceStatus, taxCop: r.taxCop, totalCop: r.totalCop,
  draftedAt: r.draftedAt, issuedAt: r.issuedAt,
});

class PrismaEventScope implements EventScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async markEventProcessed(eventId: string): Promise<boolean> {
    // ON CONFLICT DO NOTHING: si dos copias del mismo evento llegan a la vez, solo una inserta (la otra espera y ve que ya existe).
    const n = await this.tx.$executeRaw`INSERT INTO processed_events (event_id) VALUES (${eventId}::uuid) ON CONFLICT (event_id) DO NOTHING`;
    return n === 1;
  }

  async mergeFact(event: AnalyticsEvent, merge: (prev: Fact | null) => Fact): Promise<void> {
    const d = event.data;
    // 1) la fila existe (si no, se crea con lo mínimo que trae cualquier evento); 2) se bloquea; 3) se fusiona y se guarda.
    await this.tx.$executeRaw`
      INSERT INTO milestone_facts (milestone_id, project_name, milestone_name, amount_cop)
      VALUES (${d.milestoneId}, ${d.projectName}, ${d.milestoneName}, ${d.amountCop}) ON CONFLICT (milestone_id) DO NOTHING`;
    const rows = await this.tx.$queryRaw<any[]>`
      SELECT milestone_id AS "milestoneId", project_id AS "projectId", project_name AS "projectName", milestone_name AS "milestoneName", amount_cop AS "amountCop",
             approved_by AS "approvedBy", approved_at AS "approvedAt", invoice_number AS "invoiceNumber", invoice_status::text AS "invoiceStatus",
             tax_cop AS "taxCop", total_cop AS "totalCop", drafted_at AS "draftedAt", issued_at AS "issuedAt"
      FROM milestone_facts WHERE milestone_id = ${d.milestoneId} FOR UPDATE`;
    const prev = rows[0] ? toFact(rows[0]) : null;
    // La fila recién creada solo trae lo mínimo: se trata como «sin información previa» para que mande el evento.
    const isFresh = !!prev && prev.approvedAt === null && prev.invoiceNumber === null;
    const f = merge(isFresh ? null : prev);
    await this.tx.milestoneFact.update({
      where: { milestoneId: f.milestoneId },
      data: {
        projectId: f.projectId, projectName: f.projectName, milestoneName: f.milestoneName, amountCop: f.amountCop, approvedBy: f.approvedBy, approvedAt: f.approvedAt,
        invoiceNumber: f.invoiceNumber, invoiceStatus: f.invoiceStatus, taxCop: f.taxCop, totalCop: f.totalCop, draftedAt: f.draftedAt, issuedAt: f.issuedAt, updatedAt: new Date(),
      },
    });
  }

  async addActivity(eventId: string, kind: string, message: string, occurredAt: Date): Promise<void> {
    await this.tx.activityEntry.create({ data: { eventId, kind, message, occurredAt } });
  }
}
