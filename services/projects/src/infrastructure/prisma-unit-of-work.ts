import { Prisma, PrismaClient } from '@prisma/client';
import { MILESTONE_APPROVED_ROUTING_KEY, MilestoneApprovedEvent } from '../domain/events';
import { Milestone } from '../domain/milestone';
import { TransactionScope, UnitOfWork } from '../domain/ports';

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (client) => work(new PrismaTransactionScope(client)),
      { timeout: 10_000, maxWait: 10_000 },
    );
  }
}

class PrismaTransactionScope implements TransactionScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async findMilestoneForUpdate(id: string) {
    // FOR UPDATE: otra transacción que apruebe el mismo hito espera aquí y, al continuar, ya lo ve aprobado.
    const rows = await this.tx.$queryRaw<
      { id: string; project_id: string; name: string; amount_cop: number; status: 'pending' | 'approved'; approved_at: Date | null; approved_by: string | null; project_name: string }[]
    >`SELECT m.id, m.project_id, m.name, m.amount_cop, m.status::text AS status, m.approved_at, m.approved_by, p.name AS project_name
      FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.id = ${id} FOR UPDATE OF m`;
    const r = rows[0];
    if (!r) return null;
    const milestone: Milestone = { id: r.id, projectId: r.project_id, name: r.name, amountCop: r.amount_cop, status: r.status, approvedAt: r.approved_at, approvedBy: r.approved_by };
    return { milestone, projectName: r.project_name };
  }

  async saveMilestone(m: Milestone) {
    await this.tx.milestone.update({ where: { id: m.id }, data: { status: m.status, approvedAt: m.approvedAt, approvedBy: m.approvedBy } });
  }

  async addToOutbox(event: MilestoneApprovedEvent) {
    await this.tx.outboxEvent.create({
      data: {
        id: event.eventId,
        aggregateId: event.data.milestoneId,
        type: event.type,
        routingKey: MILESTONE_APPROVED_ROUTING_KEY,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
