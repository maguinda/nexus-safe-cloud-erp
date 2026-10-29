import { Invoice } from './invoice';

const DAY_MS = 86_400_000;
/** Medianoche UTC del día de calendario de esa fecha (la misma regla de «días UTC» de la fecha de vencimiento, del tablero y de la pantalla). */
export const utcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
/** AAAA-MM-DD en UTC: lo que la consulta compara contra la fecha de vencimiento. */
export const utcDateString = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Días de calendario (UTC) que lleva vencida una factura: 0 si no está vencida. Solo las EMITIDAS vencen (un borrador no tiene fecha) y vence cuando el día de hoy es
 * POSTERIOR al día de vencimiento: el mismo día del vencimiento todavía no está vencida. No hay pagos en este MVP: toda factura emitida cuenta como por cobrar.
 */
export function daysOverdue(i: Pick<Invoice, 'status' | 'dueDate'>, now: Date): number {
  if (i.status !== 'issued' || !i.dueDate) return 0;
  const days = Math.round((utcDay(now) - utcDay(i.dueDate)) / DAY_MS);
  return days > 0 ? days : 0;
}
export const isOverdue = (i: Pick<Invoice, 'status' | 'dueDate'>, now: Date): boolean => daysOverdue(i, now) > 0;
