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
    /** El cliente del proyecto: con él facturación sabe a quién se factura (datos fiscales en su propio servicio, nunca por el bus). */
    clientName: string;
    amountCop: number;
    approvedBy: string;
  };
}

export const MILESTONE_APPROVED_ROUTING_KEY = 'project.milestone.approved';

/** Se publica al CREAR un hito (queda pendiente): así Analytics sabe de los hitos que todavía no se aprueban. */
export interface MilestoneCreatedEvent {
  eventId: string;
  type: 'MilestoneCreated';
  occurredAt: string;
  correlationId: string;
  data: { milestoneId: string; milestoneName: string; projectId: string; projectName: string; amountCop: number };
}

export const MILESTONE_CREATED_ROUTING_KEY = 'project.milestone.created';

export type ProjectEvent = MilestoneApprovedEvent | MilestoneCreatedEvent;
export const routingKeyOf = (e: ProjectEvent): string => (e.type === 'MilestoneCreated' ? MILESTONE_CREATED_ROUTING_KEY : MILESTONE_APPROVED_ROUTING_KEY);

export function milestoneCreated(m: Milestone, projectName: string, correlationId: string, now: Date): MilestoneCreatedEvent {
  return {
    eventId: randomUUID(), type: 'MilestoneCreated', occurredAt: now.toISOString(), correlationId,
    data: { milestoneId: m.id, milestoneName: m.name, projectId: m.projectId, projectName, amountCop: m.amountCop },
  };
}

export function milestoneApproved(m: Milestone, projectName: string, clientName: string, correlationId: string, now: Date): MilestoneApprovedEvent {
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
      clientName,
      amountCop: m.amountCop,
      approvedBy: m.approvedBy as string,
    },
  };
}
