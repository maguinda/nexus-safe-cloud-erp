export const WO_TYPES = ['inspection', 'preventive', 'corrective'] as const;
export const WO_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export const WO_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export const WO_TARGETS = ['sensor', 'device'] as const;
export type WoType = (typeof WO_TYPES)[number];
export type WoStatus = (typeof WO_STATUSES)[number];
export class InvalidWorkOrderError extends Error {}
export class WorkOrderStateError extends Error {}

// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u001f<>]/;
const SENSOR_REF = /^[A-Za-z0-9_.:-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface NewWorkOrder {
  type: WoType; priority: (typeof WO_PRIORITIES)[number]; targetKind: (typeof WO_TARGETS)[number]; targetRef: string; description: string;
  sourceNote: string | null; dueDate: string | null; assignedTo: string | null; assignedToId: string | null;
}

function text(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== 'string') throw new InvalidWorkOrderError(`${field} must be text`);
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length < min || t.length > max) throw new InvalidWorkOrderError(`${field} must be ${min} to ${max} characters`);
  if (BAD.test(t)) throw new InvalidWorkOrderError(`${field} has characters that are not allowed`);
  return t;
}
const empty = (v: unknown) => v === undefined || v === null || v === '';
const oneOf = <T extends string>(v: unknown, list: readonly T[], f: string): T => { if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new InvalidWorkOrderError(`${f} must be one of: ${list.join(', ')}`); return v as T; };

/** Valida lo que llega del cliente. El NOMBRE del equipo no se acepta del cliente: se lee de la base. `today` (YYYY-MM-DD) fija el mínimo de la fecha límite. */
export function validateNewWorkOrder(i: Record<string, unknown>, today: string): NewWorkOrder {
  const targetKind = oneOf(i.targetKind, WO_TARGETS, 'targetKind');
  const ref = typeof i.targetRef === 'string' || typeof i.targetRef === 'number' ? String(i.targetRef) : '';
  if (targetKind === 'device' ? !/^\d{1,9}$/.test(ref) : !SENSOR_REF.test(ref)) throw new InvalidWorkOrderError('targetRef is not valid for that kind of equipment');
  let dueDate: string | null = null;
  if (!empty(i.dueDate)) {
    const d = i.dueDate;
    if (typeof d !== 'string' || !DAY.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) throw new InvalidWorkOrderError('dueDate must be a real date (YYYY-MM-DD)');
    if (d < today) throw new InvalidWorkOrderError('dueDate cannot be in the past');
    if (d > '2100-12-31') throw new InvalidWorkOrderError('dueDate is too far away');
    dueDate = d;
  }
  return {
    type: oneOf(i.type, WO_TYPES, 'type'), priority: empty(i.priority) ? 'normal' : oneOf(i.priority, WO_PRIORITIES, 'priority'), targetKind, targetRef: ref,
    description: text(i.description, 'description', 3, 300), sourceNote: empty(i.sourceNote) ? null : text(i.sourceNote, 'sourceNote', 1, 200), dueDate,
    assignedTo: empty(i.assignedTo) ? null : text(i.assignedTo, 'assignedTo', 2, 80), assignedToId: validateAssigneeId(i.assignedToId, i.assignedTo),
  };
}

const NEXT: Record<WoStatus, WoStatus[]> = { open: ['in_progress', 'done', 'cancelled'], in_progress: ['done', 'cancelled'], done: [], cancelled: [] };
export const canTransition = (from: WoStatus, to: WoStatus) => NEXT[from].includes(to);
export const isClosing = (to: WoStatus) => to === 'done' || to === 'cancelled';

export function validateStatusChange(status: unknown, note: unknown): { status: WoStatus; note: string | null } {
  return { status: oneOf(status, WO_STATUSES, 'status'), note: empty(note) ? null : text(note, 'note', 1, 300) };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** El id de la persona (de la lista de Capacidad): opcional, un UUID, y no vale sin el nombre. */
export function validateAssigneeId(id: unknown, name: unknown): string | null {
  if (empty(id)) return null;
  if (typeof id !== 'string' || !UUID.test(id)) throw new InvalidWorkOrderError('assignedToId must be a UUID');
  if (empty(name)) throw new InvalidWorkOrderError('assignedToId needs the name of the person (assignedTo)');
  return id.toLowerCase();
}
export function validateAssignee(v: unknown): string | null { return empty(v) ? null : text(v, 'assignedTo', 2, 80); }

export const orderLabel = (n: number) => `OT-${String(n).padStart(4, '0')}`;
