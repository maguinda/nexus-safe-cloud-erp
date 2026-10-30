import { randomUUID } from 'crypto';
import { Invoice } from './invoice';

/** Contrato en docs/events.md. Los cambios deben ser retrocompatibles: se agregan campos, no se quitan. */
interface InvoiceEventData {
  invoiceNumber: string;
  milestoneId: string;
  projectName: string;
  milestoneName: string;
  /** Subtotal antes de IVA. */
  amountCop: number;
  taxCop: number;
  totalCop: number;
}

interface Envelope<T extends string, D> {
  eventId: string;
  type: T;
  occurredAt: string;
  correlationId: string;
  data: D;
}

export type InvoiceDraftedEvent = Envelope<'InvoiceDrafted', InvoiceEventData & { approvedBy: string | null }>;
export type InvoiceIssuedEvent = Envelope<'InvoiceIssued', InvoiceEventData & { issuedBy: string; dueDate: string }>;
/** Una factura emitida que ya pasó su día de vencimiento. Se publica UNA vez por factura (la base lo garantiza). Sin datos personales: solo montos y nombres de negocio. */
export type OverdueDetectedEvent = Envelope<'OverdueDetected', InvoiceEventData & { clientName: string | null; dueDate: string; daysOverdue: number }>;
/** Un pago registrado contra una factura emitida. `balanceCop` es lo que queda DESPUÉS de este pago; `paidInFull` dice si quedó en 0. Sin datos personales: montos y nombres de negocio. */
export type PaymentReceivedEvent = Envelope<'PaymentReceived', { invoiceNumber: string; milestoneId: string; projectName: string; milestoneName: string; clientName: string | null; totalCop: number; paymentId: string; paymentCop: number; paidCop: number; balanceCop: number; paidInFull: boolean; method: string; paidAt: string }>;
export type BillingEvent = InvoiceDraftedEvent | InvoiceIssuedEvent | OverdueDetectedEvent | PaymentReceivedEvent;

export const INVOICE_DRAFTED_ROUTING_KEY = 'billing.invoice.drafted';
export const INVOICE_ISSUED_ROUTING_KEY = 'billing.invoice.issued';
export const INVOICE_OVERDUE_ROUTING_KEY = 'billing.invoice.overdue';
export const PAYMENT_RECEIVED_ROUTING_KEY = 'billing.payment.received';
/** El outbox no admite dos eventos del mismo tipo para el mismo «agregado»: los pagos de una factura son varios, así que cada pago es el suyo. */
export const aggregateOf = (e: BillingEvent): string => (e.type === 'PaymentReceived' ? e.data.paymentId : e.data.invoiceNumber);

export const routingKeyOf = (e: BillingEvent): string => (e.type === 'InvoiceDrafted' ? INVOICE_DRAFTED_ROUTING_KEY : e.type === 'OverdueDetected' ? INVOICE_OVERDUE_ROUTING_KEY : e.type === 'PaymentReceived' ? PAYMENT_RECEIVED_ROUTING_KEY : INVOICE_ISSUED_ROUTING_KEY);

const base = (i: Invoice): InvoiceEventData => ({
  invoiceNumber: i.number, milestoneId: i.milestoneId, projectName: i.projectName, milestoneName: i.milestoneName,
  amountCop: i.amountCop, taxCop: i.taxCop, totalCop: i.totalCop,
});

export function invoiceDrafted(i: Invoice, correlationId: string, now: Date): InvoiceDraftedEvent {
  return { eventId: randomUUID(), type: 'InvoiceDrafted', occurredAt: now.toISOString(), correlationId, data: { ...base(i), approvedBy: i.approvedBy } };
}

export function invoiceIssued(i: Invoice, correlationId: string, now: Date): InvoiceIssuedEvent {
  return { eventId: randomUUID(), type: 'InvoiceIssued', occurredAt: now.toISOString(), correlationId, data: { ...base(i), issuedBy: i.issuedBy as string, dueDate: (i.dueDate as Date).toISOString() } };
}

export function invoiceOverdue(i: Invoice, days: number, correlationId: string, now: Date): OverdueDetectedEvent {
  return {
    eventId: randomUUID(), type: 'OverdueDetected', occurredAt: now.toISOString(), correlationId,
    data: { ...base(i), clientName: i.clientName, dueDate: (i.dueDate as Date).toISOString(), daysOverdue: days },
  };
}

export function paymentReceived(i: Invoice, p: { id: string; amountCop: number; method: string; paidAt: Date }, paidCop: number, correlationId: string, now: Date): PaymentReceivedEvent {
  const balanceCop = i.totalCop - paidCop;
  return {
    eventId: randomUUID(), type: 'PaymentReceived', occurredAt: now.toISOString(), correlationId,
    data: { invoiceNumber: i.number, milestoneId: i.milestoneId, projectName: i.projectName, milestoneName: i.milestoneName, clientName: i.clientName, totalCop: i.totalCop, paymentId: p.id, paymentCop: p.amountCop, paidCop, balanceCop, paidInFull: balanceCop === 0, method: p.method, paidAt: p.paidAt.toISOString() },
  };
}
