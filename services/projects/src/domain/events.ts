import { randomUUID } from 'crypto';
import { Milestone } from './milestone';

/** Contrato en docs/events.md. Los cambios deben ser retrocompatibles: se agregan campos, no se quitan. */
export interface MilestoneApprovedEvent {
  eventId: string;
  type: 'MilestoneApproved';
  occurredAt: string;
  correlationId: string;
  data: {
    milestoneId: string;
    milestoneName: string;
    projectId: string;
    projectName: string;
    amountCop: number;
    approvedBy: string;
  };
}

export const MILESTONE_APPROVED_ROUTING_KEY = 'project.milestone.approved';

export function milestoneApproved(m: Milestone, projectName: string, correlationId: string, now: Date): MilestoneApprovedEvent {
  return {
    eventId: randomUUID(),
    type: 'MilestoneApproved',
    occurredAt: now.toISOString(),
    correlationId,
    data: {
      milestoneId: m.id,
      milestoneName: m.name,
      projectId: m.projectId,
      projectName,
      amountCop: m.amountCop,
      approvedBy: m.approvedBy as string,
    },
  };
}
