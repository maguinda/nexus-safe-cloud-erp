import { randomUUID } from 'crypto';
import { InvalidInputError, MilestoneAlreadyApprovedError } from './errors';
import { cleanText, MAX_MILESTONE_AMOUNT_COP } from './project';

export type MilestoneStatus = 'pending' | 'approved';

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  amountCop: number;
  status: MilestoneStatus;
  approvedAt: Date | null;
  approvedBy: string | null;
}

/** Regla de dominio: un hito se aprueba una sola vez. No muta el original. */
export function approve(m: Milestone, approvedBy: string, now: Date): Milestone {
  if (m.status === 'approved') throw new MilestoneAlreadyApprovedError(m.id);
  return { ...m, status: 'approved', approvedAt: now, approvedBy };
}

/** Un hito nuevo siempre nace pendiente; el id lo genera el servidor (m-xxxxxxxx). */
export function newMilestone(projectId: string, name: unknown, amountCop: unknown): Milestone {
  if (typeof amountCop !== 'number' || !Number.isInteger(amountCop) || amountCop < 1 || amountCop > MAX_MILESTONE_AMOUNT_COP) {
    throw new InvalidInputError(`amountCop must be a whole number between 1 and ${MAX_MILESTONE_AMOUNT_COP}`);
  }
  return { id: `m-${randomUUID().slice(0, 8)}`, projectId, name: cleanText(name, 'name'), amountCop, status: 'pending', approvedAt: null, approvedBy: null };
}
