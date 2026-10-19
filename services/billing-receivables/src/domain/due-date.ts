/** Plazo de pago por omisión: una factura vence 30 días de calendario después de emitirse. */
export const DEFAULT_TERM_DAYS = 30;
/** Tope razonable del plazo (10 años): evita fechas absurdas por un error de captura. */
export const MAX_TERM_DAYS = 3650;

/**
 * Fecha de vencimiento = fecha de emisión + plazo, en días de calendario y en UTC.
 * UTC a propósito: con la hora local, un cambio de horario (o la zona del servidor) movería el resultado.
 * No modifica la fecha recibida: devuelve una nueva.
 */
export function dueDate(issuedAt: Date, termDays = DEFAULT_TERM_DAYS): Date {
  if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) throw new RangeError('issuedAt must be a valid date');
  if (!Number.isInteger(termDays) || termDays < 0 || termDays > MAX_TERM_DAYS) throw new RangeError(`termDays must be an integer between 0 and ${MAX_TERM_DAYS}`);
  const due = new Date(issuedAt.getTime());
  due.setUTCDate(due.getUTCDate() + termDays);
  return due;
}
