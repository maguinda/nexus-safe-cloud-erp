import { MAX_SUBTOTAL_COP } from './tax';
import { InvalidEventError } from './errors';

/** Contrato en docs/events.md. Los campos extra se ignoran (compatibilidad hacia adelante); los que faltan o son raros, no. */
export interface MilestoneApprovedEvent {
  eventId: string;
  type: 'MilestoneApproved';
  occurredAt: string;
  correlationId: string;
  data: { milestoneId: string; milestoneName: string; projectId: string; projectName: string; amountCop: number; approvedBy: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const CORR = /^[A-Za-z0-9._-]{8,64}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

function text(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw new InvalidEventError(`${field} must be a non-empty string up to ${max} chars`);
  return v;
}

/** Todo lo que llega por el bus es entrada no confiable: se valida antes de tocar la base de datos. */
export function parseMilestoneApproved(raw: unknown): MilestoneApprovedEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('body must be an object');
  const e = raw as Record<string, any>;
  if (e.type !== 'MilestoneApproved') throw new InvalidEventError('unexpected type');
  if (typeof e.eventId !== 'string' || !UUID.test(e.eventId)) throw new InvalidEventError('eventId must be a UUID');
  if (typeof e.occurredAt !== 'string' || Number.isNaN(Date.parse(e.occurredAt))) throw new InvalidEventError('occurredAt must be an ISO date');
  if (typeof e.correlationId !== 'string' || !CORR.test(e.correlationId)) throw new InvalidEventError('correlationId has an invalid format');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  if (typeof d.milestoneId !== 'string' || !ID.test(d.milestoneId)) throw new InvalidEventError('milestoneId has an invalid format');
  if (typeof d.projectId !== 'string' || !ID.test(d.projectId)) throw new InvalidEventError('projectId has an invalid format');
  if (!Number.isInteger(d.amountCop) || d.amountCop < 1 || d.amountCop > MAX_SUBTOTAL_COP) throw new InvalidEventError(`amountCop must be an integer between 1 and ${MAX_SUBTOTAL_COP}`);
  if (typeof d.approvedBy !== 'string' || d.approvedBy.length > 254 || !EMAIL.test(d.approvedBy)) throw new InvalidEventError('approvedBy must be an email');
  return {
    eventId: e.eventId.toLowerCase(),
    type: 'MilestoneApproved',
    occurredAt: e.occurredAt,
    correlationId: e.correlationId,
    data: {
      milestoneId: d.milestoneId,
      milestoneName: text(d.milestoneName, 'milestoneName'),
      projectId: d.projectId,
      projectName: text(d.projectName, 'projectName'),
      amountCop: d.amountCop,
      approvedBy: d.approvedBy,
    },
  };
}
