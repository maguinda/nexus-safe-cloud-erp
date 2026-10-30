import { BillingEvent } from './events';
import { FiscalCustomer } from './einvoice/customer';
import { EInvoiceStatus } from './einvoice/legal';
import { EInvoiceListStatus } from './einvoice/status';
import { Party } from './einvoice/document';
import { Invoice } from './invoice';
import { Payment } from './payment';

export interface InvoiceListItem extends Invoice { electronicStatus: EInvoiceListStatus; paidCop: number }
export interface InvoiceQueries {
  /** Más nuevas primero. */
  list(): Promise<InvoiceListItem[]>;
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

/** Lo que registrar un pago hace dentro de UNA transacción: bloquea la factura, suma lo pagado DENTRO del bloqueo, guarda el pago y su evento. */
export interface PaymentScope {
  /** Bloquea la factura (FOR UPDATE) y devuelve con ella lo pagado hasta ahora (leído ya con el bloqueo puesto). null si no existe. */
  lockInvoice(number: string): Promise<{ invoice: Invoice; paidCop: number } | null>;
  insertPayment(p: Payment): Promise<void>;
  addToOutbox(event: BillingEvent): Promise<void>;
}
export interface PaymentUnitOfWork {
  run<T>(work: (tx: PaymentScope) => Promise<T>): Promise<T>;
}
export interface PaymentQueries {
  /** Más reciente primero; null si la factura no existe. */
  listForInvoice(number: string): Promise<Payment[] | null>;
}

/** Lo que el detector de facturas vencidas hace dentro de UNA transacción. */
export interface OverdueScope {
  /** Facturas emitidas con vencimiento anterior a `today` (AAAA-MM-DD, UTC) que todavía no tienen su evento OverdueDetected. Las bloquea (FOR UPDATE SKIP LOCKED): varias réplicas no se pisan. */
  findNewlyOverdue(today: string, limit: number): Promise<Invoice[]>;
  /** true si se escribió; false si ya había uno para esa factura (dos detectores a la vez no duplican ni fallan: el segundo simplemente no escribe). */
  addToOutbox(event: BillingEvent): Promise<boolean>;
}
export interface OverdueUnitOfWork {
  run<T>(work: (tx: OverdueScope) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------- factura electrónica (sandbox)

/** El documento tal como se guardó (inmutable salvo su estado de envío). */
export interface StoredEInvoice {
  id: string;
  invoiceNumber: string;
  number: string;
  issueDate: string;
  issueTime: string;
  dueDate: string;
  cufe: string;
  environment: 'sandbox';
  status: EInvoiceStatus;
  xml: string;
  qrText: string;
  supplier: Party;
  customer: Party;
  /** Montos y nombres de la factura al generar el documento. */
  invoice: InvoiceSummary;
  providerRef: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  deliveries: number;
}

export interface NewEInvoice {
  invoiceNumber: string;
  prefix: string;
  consecutive: number;
  number: string;
  issueDate: string;
  issueTime: string;
  dueDate: string;
  cufe: string;
  xml: string;
  qrText: string;
  supplier: Party;
  customer: Party;
  invoice: InvoiceSummary;
}

export interface Numbering { prefix: string; consecutive: number; validFrom: Date; validTo: Date }

/** Lo que la generación hace dentro de UNA transacción. Orden de bloqueos (siempre el mismo): factura, cliente, contador. */
export interface EInvoiceScope {
  findInvoiceForUpdate(number: string): Promise<Invoice | null>;
  findElectronic(invoiceNumber: string): Promise<StoredEInvoice | null>;
  findCustomerForShare(key: string): Promise<FiscalCustomer | null>;
  /** Toma el siguiente consecutivo (UPDATE ... RETURNING); lanza NumberingExhaustedError si ya no quedan. */
  takeNextConsecutive(): Promise<Numbering>;
  insertElectronic(e: NewEInvoice): Promise<StoredEInvoice>;
}
export interface EInvoiceUnitOfWork {
  run<T>(work: (tx: EInvoiceScope) => Promise<T>): Promise<T>;
}

export interface InvoiceSummary { number: string; milestoneName: string; projectName: string; amountCop: number; taxCop: number; totalCop: number }

export interface EInvoiceRepository {
  findByInvoiceNumber(invoiceNumber: string): Promise<StoredEInvoice | null>;
  /** Pasa de `generated` a `sandbox_simulated` una sola vez; si ya estaba enviada devuelve la que hay (la primera gana). */
  markSubmitted(invoiceNumber: string, providerRef: string, at: Date): Promise<StoredEInvoice | null>;
  /** Registra el envío por correo al correo que quedó en el documento (no hay servidor de correo conectado). */
  addDelivery(invoiceNumber: string, recipient: string): Promise<StoredEInvoice | null>;
}

export interface CustomerRepository {
  list(): Promise<(FiscalCustomer & { updatedAt: Date })[]>;
  upsert(c: FiscalCustomer, key: string): Promise<FiscalCustomer>;
}

/** Dibuja el texto del QR como SVG (la librería es un detalle de infraestructura). */
export interface QrRenderer { toSvg(text: string): Promise<string> }
