import type { WorkOrder } from './types';
import { dueState, type DueState } from './invoice-table';

export type Tone3 = 'ok' | 'warn' | 'bad';

/** Semáforo de la carga: hasta 80 % verde, de 81 a 100 % ámbar, más de 100 % rojo. */
export function loadTone(pct: number): Tone3 { return pct > 100 ? 'bad' : pct > 80 ? 'warn' : 'ok'; }

export type OrderFilter = 'todo' | 'doing' | 'done' | 'all';
export const isActive = (o: Pick<WorkOrder, 'status'>) => o.status === 'open' || o.status === 'in_progress';

/** Vencimiento de una orden: solo cuenta mientras está abierta o en curso (una terminada o cancelada ya no vence). */
export function orderDue(o: Pick<WorkOrder, 'status' | 'dueDate'>, nowMs: number): DueState {
  return isActive(o) ? dueState(o.dueDate, nowMs) : { state: 'none', days: null };
}

const PRIORITY_RANK: Record<WorkOrder['priority'], number> = { critical: 0, high: 1, normal: 2, low: 3 };

/** Lo más urgente primero: vencidas, luego por fecha de entrega (sin fecha al final), luego por prioridad y por número. */
export function byUrgency(a: WorkOrder, b: WorkOrder, nowMs: number): number {
  const da = orderDue(a, nowMs), db = orderDue(b, nowMs);
  const oa = da.state === 'overdue' ? 0 : 1, ob = db.state === 'overdue' ? 0 : 1;
  if (oa !== ob) return oa - ob;
  const ka = a.dueDate ?? '9999-12-31', kb = b.dueDate ?? '9999-12-31';
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
}

export interface WorkSummary { todo: number; doing: number; done: number; overdue: number; total: number }

/** Cuenta lo mío. Las canceladas no cuentan (no son trabajo mío ni pendiente ni hecho). */
export function summarize(orders: WorkOrder[], nowMs: number): WorkSummary {
  const live = orders.filter((o) => o.status !== 'cancelled');
  return {
    todo: live.filter((o) => o.status === 'open').length,
    doing: live.filter((o) => o.status === 'in_progress').length,
    done: live.filter((o) => o.status === 'done').length,
    overdue: live.filter((o) => orderDue(o, nowMs).state === 'overdue').length,
    total: live.length,
  };
}

export function filterOrders(orders: WorkOrder[], f: OrderFilter, nowMs: number): WorkOrder[] {
  const live = orders.filter((o) => o.status !== 'cancelled');
  const pick = f === 'todo' ? live.filter((o) => o.status === 'open') : f === 'doing' ? live.filter((o) => o.status === 'in_progress') : f === 'done' ? live.filter((o) => o.status === 'done') : live;
  // Lo abierto por urgencia; lo terminado, lo más reciente primero.
  const open = pick.filter(isActive).sort((a, b) => byUrgency(a, b, nowMs));
  const closed = pick.filter((o) => !isActive(o)).sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '') || (a.number < b.number ? -1 : 1));
  return [...open, ...closed];
}

export type ListState = 'done' | 'doing' | 'todo' | 'bad';
export interface ListEntry { order: WorkOrder; state: ListState }

/** «Mi lista»: lo último que hice (hasta `doneMax`), lo que estoy haciendo y lo que falta, lo más urgente primero. Vencida = 'bad'. */
export function myList(orders: WorkOrder[], nowMs: number, max = 8, doneMax = 2): ListEntry[] {
  const live = orders.filter((o) => o.status !== 'cancelled');
  const active = live.filter(isActive).sort((a, b) => byUrgency(a, b, nowMs));
  const done = live.filter((o) => o.status === 'done').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')).slice(0, doneMax);
  const entries: ListEntry[] = [
    ...done.map((o) => ({ order: o, state: 'done' as const })),
    ...active.map((o) => ({ order: o, state: orderDue(o, nowMs).state === 'overdue' ? ('bad' as const) : o.status === 'in_progress' ? ('doing' as const) : ('todo' as const) })),
  ];
  // Si hay más que `max`, se recorta lo que falta (lo último de la lista), nunca lo hecho.
  const keep = entries.filter((e) => e.state === 'done');
  const rest = entries.filter((e) => e.state !== 'done').slice(0, Math.max(0, max - keep.length));
  return [...keep, ...rest];
}
