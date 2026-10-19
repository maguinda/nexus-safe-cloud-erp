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
export type BillingEvent = InvoiceDraftedEvent | InvoiceIssuedEvent;

export const INVOICE_DRAFTED_ROUTING_KEY = 'billing.invoice.drafted';
export const INVOICE_ISSUED_ROUTING_KEY = 'billing.invoice.issued';

export const routingKeyOf = (e: BillingEvent): string => (e.type === 'InvoiceDrafted' ? INVOICE_DRAFTED_ROUTING_KEY : INVOICE_ISSUED_ROUTING_KEY);

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
