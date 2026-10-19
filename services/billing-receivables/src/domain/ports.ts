import { BillingEvent } from './events';
import { Invoice } from './invoice';

export interface InvoiceQueries {
  /** Más nuevas primero. */
  list(): Promise<Invoice[]>;
}

/** Lo que el consumidor puede hacer dentro de UNA transacción: marcar el evento, revisar el hito e insertar la factura. */
export interface InboxScope {
  /** true si el evento era nuevo; false si ya se había procesado (duplicado). */
  markEventProcessed(eventId: string): Promise<boolean>;
  invoiceExistsForMilestone(milestoneId: string): Promise<boolean>;
  nextInvoiceNumber(): Promise<string>;
  insertInvoice(invoice: Invoice): Promise<void>;
  /** El aviso queda en la misma transacción que la factura: o quedan los dos o ninguno. */
  addToOutbox(event: BillingEvent): Promise<void>;
}
export interface InboxUnitOfWork {
  run<T>(work: (tx: InboxScope) => Promise<T>): Promise<T>;
}

export interface IssueScope {
  /** Bloquea la fila hasta el final de la transacción (SELECT ... FOR UPDATE). */
  findForUpdate(number: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<void>;
  addToOutbox(event: BillingEvent): Promise<void>;
}
export interface IssueUnitOfWork {
  run<T>(work: (tx: IssueScope) => Promise<T>): Promise<T>;
}
