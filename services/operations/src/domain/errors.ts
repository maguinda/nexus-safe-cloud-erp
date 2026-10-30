/** Un evento recibido del bus no cumple el contrato: va a la cola de mensajes muertos, no se reintenta. */
export class InvalidEventError extends Error {}
