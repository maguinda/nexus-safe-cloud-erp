/** Entrada inválida (400). */
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}
export class NotFoundError extends Error {
  constructor(what: string) { super(`${what} not found`); this.name = 'NotFoundError'; }
}
/** La acción choca con el estado actual (409): nombre repetido, pedido que ya no está pendiente, stock que quedaría negativo. */
export class ConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'ConflictError'; }
}
/** El mensaje del bus no cumple el contrato de docs/events.md: no se reintenta, va a la cola de mensajes muertos. */
export class InvalidEventError extends Error {
  constructor(reason: string) { super(`Invalid event: ${reason}`); this.name = 'InvalidEventError'; }
}
