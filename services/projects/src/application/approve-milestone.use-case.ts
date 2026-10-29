import { MilestoneNotFoundError } from '../domain/errors';
import { milestoneApproved } from '../domain/events';
import { approve, Milestone } from '../domain/milestone';
import { UnitOfWork } from '../domain/ports';

export interface ApproveResult {
  milestone: Milestone;
  eventId: string;
}

/**
 * Todo ocurre en UNA transacción: se bloquea el hito, se aprueba y el evento queda en el outbox.
 * Si dos personas aprueban a la vez, la segunda espera el bloqueo, ve el hito ya aprobado y recibe 409.
 */
export class ApproveMilestoneUseCase {
  constructor(private readonly uow: UnitOfWork, private readonly clock: () => Date = () => new Date()) {}

  execute(milestoneId: string, approvedBy: string, correlationId: string): Promise<ApproveResult> {
    return this.uow.run(async (tx) => {
      const found = await tx.findMilestoneForUpdate(milestoneId);
      if (!found) throw new MilestoneNotFoundError(milestoneId);
      const now = this.clock();
      const approved = approve(found.milestone, approvedBy, now);
      const event = milestoneApproved(approved, found.projectName, found.clientName, correlationId, now);
      await tx.saveMilestone(approved);
      await tx.addToOutbox(event);
      return { milestone: approved, eventId: event.eventId };
    });
  }
}
