import { MilestoneAlreadyApprovedError } from './errors';

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
