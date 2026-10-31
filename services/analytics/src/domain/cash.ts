import { InvalidEventError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORR = /^[A-Za-z0-9._-]{8,64}$/;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,120}$/;
const REF = /^[^<>\u0000-\u001f]{1,60}$/u;
const NAME = /^[^<>\u0000-\u001f]{2,120}$/u;
export const CASH_ROUTING_KEYS = ['billing.payment.received', 'capacity.payroll.paid', 'procurement.supplier.paid', 'project.quote.approved'] as const;
export const MAX_AMOUNT_COP = 100_000_000_000;

export type CashEvent =
  | { kind: 'entry'; eventId: string; date: string; direction: 'in' | 'out'; category: 'customer' | 'payroll' | 'supplier'; amountCop: number; ref: string; projectName: string | null }
  | { kind: 'quote'; eventId: string; quoteNumber: string; projectId: string; projectName: string; priceCop: number; costCop: number; marginPct: number; approvedBy: string; approvedAt: string };

function money(v: unknown, field: string, min = 1): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > MAX_AMOUNT_COP) throw new InvalidEventError(`${field} must be a whole number of pesos from ${min} to ${MAX_AMOUNT_COP}`);
  return v;
}
function text(v: unknown, field: string, re: RegExp): string {
  if (typeof v !== 'string') throw new InvalidEventError(`${field} must be text`);
  const t = v.replace(/\s+/g, ' ').trim();
  if (!re.test(t)) throw new InvalidEventError(`${field} is not valid`);
  return t;
}
const dayOf = (iso: unknown, field: string): string => { if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) throw new InvalidEventError(`${field} must be an ISO date`); return new Date(iso).toISOString().slice(0, 10); };

/** Todo lo que llega por el bus es entrada no confiable: se valida antes de tocar la base. Cobro, nómina pagada, pago a proveedor y cotización aprobada. */
export function parseCashEvent(raw: unknown): CashEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('event must be an object');
  const e = raw as Record<string, any>;
  if (typeof e.eventId !== 'string' || !UUID.test(e.eventId)) throw new InvalidEventError('eventId must be a UUID');
  if (typeof e.correlationId !== 'string' || !CORR.test(e.correlationId)) throw new InvalidEventError('correlationId has an invalid format');
  const occurred = dayOf(e.occurredAt, 'occurredAt');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  const eventId = e.eventId.toLowerCase();
  switch (e.type) {
    case 'PaymentReceived': return { kind: 'entry', eventId, date: dayOf(d.paidAt, 'paidAt'), direction: 'in', category: 'customer', amountCop: money(d.paymentCop, 'paymentCop'), ref: text(d.invoiceNumber, 'invoiceNumber', REF), projectName: d.projectName === undefined || d.projectName === null ? null : text(d.projectName, 'projectName', NAME) };
    case 'PayrollPaid': return { kind: 'entry', eventId, date: occurred, direction: 'out', category: 'payroll', amountCop: money(d.totalCop, 'totalCop'), ref: text(d.period, 'period', /^\d{4}-(0[1-9]|1[0-2])$/), projectName: null };
    case 'SupplierPaid': return { kind: 'entry', eventId, date: occurred, direction: 'out', category: 'supplier', amountCop: money(d.amountCop, 'amountCop'), ref: text(d.payableNumber, 'payableNumber', REF), projectName: d.projectName === undefined || d.projectName === null ? null : text(d.projectName, 'projectName', NAME) };
    case 'QuoteApproved': {
      if (typeof d.approvedBy !== 'string' || !EMAIL.test(d.approvedBy)) throw new InvalidEventError('approvedBy must be an email');
      const marginPct = d.marginPct;
      if (typeof marginPct !== 'number' || !Number.isInteger(marginPct) || marginPct < 0 || marginPct > 100) throw new InvalidEventError('marginPct must be a whole number from 0 to 100');
      return { kind: 'quote', eventId, quoteNumber: text(d.quoteNumber, 'quoteNumber', /^COT-\d{4,9}$/), projectId: text(d.projectId, 'projectId', /^[A-Za-z0-9_-]{1,40}$/), projectName: text(d.projectName, 'projectName', NAME), priceCop: money(d.amountCop, 'amountCop'), costCop: money(d.costCop, 'costCop', 0), marginPct, approvedBy: d.approvedBy.toLowerCase(), approvedAt: new Date(e.occurredAt).toISOString() };
    }
    default: throw new InvalidEventError('unexpected type');
  }
}
