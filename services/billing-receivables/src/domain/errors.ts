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
