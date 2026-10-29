import { InvalidEventError } from './errors';

/**
 * Eventos que Analytics consume (contrato en docs/events.md). Los campos extra se ignoran (compatibilidad hacia adelante);
 * los que faltan o son raros, no: todo lo que llega por el bus es entrada no confiable.
 */
interface Envelope { eventId: string; occurredAt: string; correlationId: string }
export interface MilestoneCreatedEvent extends Envelope {
  type: 'MilestoneCreated';
  data: { milestoneId: string; milestoneName: string; projectId: string; projectName: string; amountCop: number };
}
export interface MilestoneApprovedEvent extends Envelope {
  type: 'MilestoneApproved';
  data: { milestoneId: string; milestoneName: string; projectId: string; projectName: string; amountCop: number; approvedBy: string };
}
interface InvoiceData { invoiceNumber: string; milestoneId: string; projectName: string; milestoneName: string; amountCop: number; taxCop: number; totalCop: number }
export interface InvoiceDraftedEvent extends Envelope { type: 'InvoiceDrafted'; data: InvoiceData & { approvedBy: string | null } }
export interface InvoiceIssuedEvent extends Envelope { type: 'InvoiceIssued'; data: InvoiceData & { issuedBy: string } }
export interface InvoiceOverdueEvent extends Envelope { type: 'InvoiceOverdue'; data: InvoiceData & { dueDate: string; daysOverdue: number } }
export type AnalyticsEvent = MilestoneCreatedEvent | MilestoneApprovedEvent | InvoiceDraftedEvent | InvoiceIssuedEvent | InvoiceOverdueEvent;

export const ROUTING_KEYS = ['project.milestone.created', 'project.milestone.approved', 'billing.invoice.drafted', 'billing.invoice.issued', 'billing.invoice.overdue'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const CORR = /^[A-Za-z0-9._-]{8,64}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const INVOICE = /^INV-\d{4,9}$/;
export const MAX_AMOUNT_COP = 1_000_000_000;
const INT32 = 2_147_483_647;

function text(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw new InvalidEventError(`${field} must be a non-empty string up to ${max} chars`);
  return v;
}
function id(v: unknown, field: string): string {
  if (typeof v !== 'string' || !ID.test(v)) throw new InvalidEventError(`${field} has an invalid format`);
  return v;
}
function email(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length > 254 || !EMAIL.test(v)) throw new InvalidEventError(`${field} must be an email`);
  return v;
}
function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new InvalidEventError(`${field} must be an integer between ${min} and ${max}`);
  return v;
}

function invoiceData(d: Record<string, any>): InvoiceData {
  const amountCop = int(d.amountCop, 'amountCop', 1, MAX_AMOUNT_COP);
  const taxCop = int(d.taxCop, 'taxCop', 0, INT32);
  const totalCop = int(d.totalCop, 'totalCop', 1, INT32);
  if (totalCop !== amountCop + taxCop) throw new InvalidEventError('totalCop must equal amountCop + taxCop');
  if (typeof d.invoiceNumber !== 'string' || !INVOICE.test(d.invoiceNumber)) throw new InvalidEventError('invoiceNumber has an invalid format');
  return { invoiceNumber: d.invoiceNumber, milestoneId: id(d.milestoneId, 'milestoneId'), projectName: text(d.projectName, 'projectName'), milestoneName: text(d.milestoneName, 'milestoneName'), amountCop, taxCop, totalCop };
}

export function parseEvent(raw: unknown): AnalyticsEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('body must be an object');
  const e = raw as Record<string, any>;
  if (typeof e.eventId !== 'string' || !UUID.test(e.eventId)) throw new InvalidEventError('eventId must be a UUID');
  if (typeof e.occurredAt !== 'string' || Number.isNaN(Date.parse(e.occurredAt))) throw new InvalidEventError('occurredAt must be an ISO date');
  if (typeof e.correlationId !== 'string' || !CORR.test(e.correlationId)) throw new InvalidEventError('correlationId has an invalid format');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  const base = { eventId: e.eventId.toLowerCase(), occurredAt: e.occurredAt, correlationId: e.correlationId };
  switch (e.type) {
    case 'MilestoneCreated':
      return { ...base, type: 'MilestoneCreated', data: {
        milestoneId: id(d.milestoneId, 'milestoneId'), milestoneName: text(d.milestoneName, 'milestoneName'), projectId: id(d.projectId, 'projectId'),
        projectName: text(d.projectName, 'projectName'), amountCop: int(d.amountCop, 'amountCop', 1, MAX_AMOUNT_COP) } };
    case 'MilestoneApproved':
      return { ...base, type: 'MilestoneApproved', data: {
        milestoneId: id(d.milestoneId, 'milestoneId'), milestoneName: text(d.milestoneName, 'milestoneName'), projectId: id(d.projectId, 'projectId'),
        projectName: text(d.projectName, 'projectName'), amountCop: int(d.amountCop, 'amountCop', 1, MAX_AMOUNT_COP), approvedBy: email(d.approvedBy, 'approvedBy') } };
    case 'InvoiceDrafted':
      return { ...base, type: 'InvoiceDrafted', data: { ...invoiceData(d), approvedBy: d.approvedBy == null ? null : email(d.approvedBy, 'approvedBy') } };
    case 'InvoiceOverdue': {
      if (typeof d.dueDate !== 'string' || Number.isNaN(Date.parse(d.dueDate))) throw new InvalidEventError('dueDate must be an ISO date');
      return { ...base, type: 'InvoiceOverdue', data: { ...invoiceData(d), dueDate: d.dueDate, daysOverdue: int(d.daysOverdue, 'daysOverdue', 1, 36_500) } };
    }
    case 'InvoiceIssued':
      return { ...base, type: 'InvoiceIssued', data: { ...invoiceData(d), issuedBy: email(d.issuedBy, 'issuedBy') } };
    default:
      throw new InvalidEventError('unexpected type');
  }
}
