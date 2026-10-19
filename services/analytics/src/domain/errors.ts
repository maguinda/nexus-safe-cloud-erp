/** El mensaje no cumple el contrato de docs/events.md: no se reintenta, va a la cola de mensajes muertos. */
export class InvalidEventError extends Error {
  constructor(reason: string) { super(`Invalid event: ${reason}`); this.name = 'InvalidEventError'; }
}
