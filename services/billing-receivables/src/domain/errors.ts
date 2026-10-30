export class InvoiceNotFoundError extends Error {
  constructor(n: string) { super(`Invoice ${n} not found`); this.name = 'InvoiceNotFoundError'; }
}
export class InvoiceNotDraftError extends Error {
  constructor(n: string) { super(`Invoice ${n} is not a draft`); this.name = 'InvoiceNotDraftError'; }
}
/** El mensaje no cumple el contrato de docs/events.md: no se reintenta, va a la cola de mensajes muertos. */
export class InvalidEventError extends Error {
  constructor(reason: string) { super(`Invalid event: ${reason}`); this.name = 'InvalidEventError'; }
}
/** Datos fiscales del cliente inválidos (NIT, DV, correo, textos). */
export class InvalidCustomerError extends Error {
  constructor(reason: string) { super(`Invalid customer data: ${reason}`); this.name = 'InvalidCustomerError'; }
}
/** La factura todavía no se puede convertir en documento electrónico (borrador, sin cliente, sin datos fiscales). */
export class EInvoiceNotReadyError extends Error {
  constructor(reason: string) { super(`Electronic invoice not ready: ${reason}`); this.name = 'EInvoiceNotReadyError'; }
}
/** El documento ya tiene el máximo de registros de envío por correo. */
export class DeliveryLimitError extends Error {
  constructor(max: number) { super(`The delivery registry of this document is full (${max} records)`); this.name = 'DeliveryLimitError'; }
}
export class EInvoiceNotFoundError extends Error {
  constructor(n: string) { super(`Invoice ${n} has no electronic document`); this.name = 'EInvoiceNotFoundError'; }
}
/** Se agotó el rango de numeración de la resolución: no se genera nada más hasta cargar otra. */
export class NumberingExhaustedError extends Error {
  constructor() { super('The authorized numbering range is exhausted'); this.name = 'NumberingExhaustedError'; }
}
/** El pago no cumple el contrato (monto, medio, referencia): 400. */
export class InvalidPaymentError extends Error {
  constructor(reason: string) { super(`Invalid payment: ${reason}`); this.name = 'InvalidPaymentError'; }
}
/** Solo se cobra una factura EMITIDA (409). */
export class PaymentNotAllowedError extends Error {
  constructor(n: string) { super(`Invoice ${n} is not issued: only issued invoices can receive payments`); this.name = 'PaymentNotAllowedError'; }
}
/** El pago pasaría del saldo de la factura (409). */
export class OverpaymentError extends Error {
  constructor(public readonly balanceCop: number) { super(`The payment is higher than the balance of the invoice (${balanceCop} COP)`); this.name = 'OverpaymentError'; }
}

/** Contrato con datos no válidos (400). */
export class InvalidContractError extends Error {}
/** El contrato ya no está vigente: no admite ese cambio de estado (409). */
export class ContractStateError extends Error {}
/** El contrato no existe (404). */
export class ContractNotFoundError extends Error {}
