/** Un evento recibido del bus no cumple el contrato: va a la cola de mensajes muertos, no se reintenta. */
export class InvalidEventError extends Error {}
export const WORK_ORDER_CLOSED_ROUTING_KEY = 'ops.workorder.closed';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORR = /^[A-Za-z0-9._-]{8,64}$/;

/** Contrato en docs/events.md. Todo lo que llega por el bus es entrada no confiable. Solo importa el id de la orden: lo demás se valida pero no se usa. */
export function parseWorkOrderClosed(raw: unknown): { eventId: string; orderId: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('body must be an object');
  const e = raw as Record<string, any>;
  if (e.type !== 'WorkOrderClosed') throw new InvalidEventError('unexpected type');
  if (typeof e.eventId !== 'string' || !UUID.test(e.eventId)) throw new InvalidEventError('eventId must be a UUID');
  if (typeof e.occurredAt !== 'string' || Number.isNaN(Date.parse(e.occurredAt))) throw new InvalidEventError('occurredAt must be an ISO date');
  if (typeof e.correlationId !== 'string' || !CORR.test(e.correlationId)) throw new InvalidEventError('correlationId has an invalid format');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  // orderId es nuevo: los eventos viejos (sin él) no tienen capacidad que liberar y se aceptan sin hacer nada.
  if (d.orderId === undefined) return { eventId: e.eventId.toLowerCase(), orderId: '' };
  if (typeof d.orderId !== 'string' || !UUID.test(d.orderId)) throw new InvalidEventError('orderId must be a UUID');
  if (d.outcome !== 'done' && d.outcome !== 'cancelled') throw new InvalidEventError('outcome must be done or cancelled');
  return { eventId: e.eventId.toLowerCase(), orderId: d.orderId.toLowerCase() };
}
