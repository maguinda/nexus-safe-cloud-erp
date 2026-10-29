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
