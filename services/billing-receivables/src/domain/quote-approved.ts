import { InvalidEventError } from './errors';
import { MAX_CONTRACT_COP } from './contract';
import { cleanClientName } from './milestone-approved';

/** Contrato en docs/events.md. Todo lo que llega por el bus es entrada no confiable: se valida antes de tocar la base. */
export interface QuoteApprovedEvent {
  eventId: string; type: 'QuoteApproved'; occurredAt: string; correlationId: string;
  data: { quoteId: string; quoteNumber: string; clientName: string; projectId: string; projectName: string; amountCop: number; approvedBy: string };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const CORR = /^[A-Za-z0-9._-]{8,64}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const NUMBER = /^COT-\d{4,9}$/;

function name(v: unknown, field: string): string {
  // eslint-disable-next-line no-control-regex
  if (typeof v !== 'string' || /[\u0000-\u001f<>]/.test(v)) throw new InvalidEventError(`${field} has characters that are not allowed`);
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 120) throw new InvalidEventError(`${field} must be 2 to 120 characters`);
  return t;
}

export function parseQuoteApproved(raw: unknown): QuoteApprovedEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('body must be an object');
  const e = raw as Record<string, any>;
  if (e.type !== 'QuoteApproved') throw new InvalidEventError('unexpected type');
  if (typeof e.eventId !== 'string' || !UUID.test(e.eventId)) throw new InvalidEventError('eventId must be a UUID');
  if (typeof e.occurredAt !== 'string' || Number.isNaN(Date.parse(e.occurredAt))) throw new InvalidEventError('occurredAt must be an ISO date');
  if (typeof e.correlationId !== 'string' || !CORR.test(e.correlationId)) throw new InvalidEventError('correlationId has an invalid format');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  if (typeof d.quoteId !== 'string' || !UUID.test(d.quoteId)) throw new InvalidEventError('quoteId must be a UUID');
  if (typeof d.quoteNumber !== 'string' || !NUMBER.test(d.quoteNumber)) throw new InvalidEventError('quoteNumber must look like COT-0001');
  if (typeof d.projectId !== 'string' || !ID.test(d.projectId)) throw new InvalidEventError('projectId has an invalid format');
  if (!Number.isInteger(d.amountCop) || d.amountCop < 1 || d.amountCop > MAX_CONTRACT_COP) throw new InvalidEventError(`amountCop must be an integer between 1 and ${MAX_CONTRACT_COP}`);
  if (typeof d.approvedBy !== 'string' || d.approvedBy.length > 254 || !EMAIL.test(d.approvedBy)) throw new InvalidEventError('approvedBy must be an email');
  const client = cleanClientName(d.clientName);
  if (client === null || client.length < 2) throw new InvalidEventError('clientName must be 2 to 120 characters');
  return { eventId: e.eventId.toLowerCase(), type: 'QuoteApproved', occurredAt: e.occurredAt, correlationId: e.correlationId, data: { quoteId: d.quoteId.toLowerCase(), quoteNumber: d.quoteNumber, clientName: name(client, 'clientName'), projectId: d.projectId, projectName: name(d.projectName, 'projectName'), amountCop: d.amountCop, approvedBy: d.approvedBy } };
}
