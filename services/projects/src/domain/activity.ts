import { InvalidInputError } from './errors';

/** Una actividad es un paso concreto de un hito: el ingeniero responsable del hito la crea y se la asigna a un técnico. */
export type ActivityStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export const ACTIVITY_STATUSES: readonly ActivityStatus[] = ['open', 'in_progress', 'done', 'cancelled'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Texto limpio: sin espacios de más ni caracteres de control; `min` a `max` caracteres. */
export function cleanLine(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new InvalidInputError(`${field} must be text`);
  const t = value.replace(/\s+/g, ' ').trim();
  if (t.length < min) throw new InvalidInputError(min <= 1 ? `${field} must not be empty` : `${field} must have at least ${min} characters`);
  if (t.length > max) throw new InvalidInputError(`${field} must have at most ${max} characters`);
  if (CONTROL.test(t)) throw new InvalidInputError(`${field} has invalid characters`);
  return t;
}

/** Nota o descripción opcional: vacía o ausente = null; sin < ni > (se muestran tal cual y no deben poder armar marcado). */
export function cleanNote(value: unknown, field: string, max = 300): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new InvalidInputError(`${field} must be text`);
  const t = value.replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  if (t.length > max) throw new InvalidInputError(`${field} must have at most ${max} characters`);
  if (CONTROL.test(t)) throw new InvalidInputError(`${field} has invalid characters`);
  if (/[<>]/.test(t)) throw new InvalidInputError(`${field} must not contain < or >`);
  return t;
}

export function cleanStaffId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new InvalidInputError(`${field} must be the id of a staff member`);
  return value.toLowerCase();
}

/** Fecha de calendario real (YYYY-MM-DD). `new Date('2026-02-31')` NO falla (la corre al 3 de marzo), por eso se comprueba de ida y vuelta. */
export function cleanDay(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidInputError(`${field} must be a date like 2026-11-30`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new InvalidInputError(`${field} is not a real calendar date`);
  return value;
}

export interface NewActivityInput { title: string; description: string | null; assignedToId: string; assignedTo: string; dueDate: string | null }

/** Valida y limpia lo que llega del cliente. `today` es el día de hoy (YYYY-MM-DD, UTC): una fecha límite no puede estar en el pasado. */
export function newActivity(raw: { title?: unknown; description?: unknown; assignedToId?: unknown; assignedTo?: unknown; dueDate?: unknown }, today: string): NewActivityInput {
  const dueDate = raw.dueDate === undefined || raw.dueDate === null ? null : cleanDay(raw.dueDate, 'dueDate');
  if (dueDate !== null && dueDate < today) throw new InvalidInputError('dueDate must not be in the past');
  return {
    title: cleanLine(raw.title, 'title', 3, 120),
    description: cleanNote(raw.description, 'description'),
    assignedToId: cleanStaffId(raw.assignedToId, 'assignedToId'),
    assignedTo: cleanLine(raw.assignedTo, 'assignedTo', 2, 100),
    dueDate,
  };
}

/** Transiciones que hace el técnico: open → in_progress | done; in_progress → done. Hecha y cancelada son finales. */
export function canProgress(from: ActivityStatus, to: ActivityStatus): boolean {
  if (to === 'in_progress') return from === 'open';
  if (to === 'done') return from === 'open' || from === 'in_progress';
  return false;
}
/** Se puede editar, reasignar o cancelar mientras siga viva. */
export const isLive = (s: ActivityStatus) => s === 'open' || s === 'in_progress';

export interface Progress { total: number; done: number; inProgress: number; open: number; pct: number }
/** Avance de un hito: las canceladas no cuentan (ni como pendientes ni como hechas). Sin actividades, 0 de 0 y 0 %. */
export function progressOf(list: { status: ActivityStatus }[]): Progress {
  const live = list.filter((a) => a.status !== 'cancelled');
  const done = live.filter((a) => a.status === 'done').length;
  return { total: live.length, done, inProgress: live.filter((a) => a.status === 'in_progress').length, open: live.filter((a) => a.status === 'open').length, pct: live.length === 0 ? 0 : Math.round((done / live.length) * 100) };
}
