import { dueState, type DueState } from './invoice-table';
import type { ActivityStatus, MilestoneActivity } from './types';

export const isLiveActivity = (s: ActivityStatus) => s === 'open' || s === 'in_progress';

/** Vence solo mientras sigue viva (una terminada o cancelada ya no vence). */
export function activityDue(a: Pick<MilestoneActivity, 'status' | 'dueDate'>, nowMs: number): DueState {
  return isLiveActivity(a.status) ? dueState(a.dueDate, nowMs) : { state: 'none', days: null };
}

export type ActivityFilter = 'todo' | 'doing' | 'done' | 'all';
export interface ActivitySummary { todo: number; doing: number; done: number; overdue: number; total: number }

/** Las canceladas no cuentan: ni pendientes ni hechas. */
export function summarizeActivities(list: Pick<MilestoneActivity, 'status' | 'dueDate'>[], nowMs: number): ActivitySummary {
  const live = list.filter((a) => a.status !== 'cancelled');
  return {
    todo: live.filter((a) => a.status === 'open').length, doing: live.filter((a) => a.status === 'in_progress').length, done: live.filter((a) => a.status === 'done').length,
    overdue: live.filter((a) => activityDue(a, nowMs).state === 'overdue').length, total: live.length,
  };
}

/** Lo urgente primero: vencidas, luego por fecha límite (sin fecha al final) y por código; lo terminado al final, lo más reciente primero. */
export function filterActivities<T extends Pick<MilestoneActivity, 'status' | 'dueDate' | 'code' | 'doneAt'>>(list: T[], f: ActivityFilter, nowMs: number): T[] {
  const live = list.filter((a) => a.status !== 'cancelled');
  const pick = f === 'todo' ? live.filter((a) => a.status === 'open') : f === 'doing' ? live.filter((a) => a.status === 'in_progress') : f === 'done' ? live.filter((a) => a.status === 'done') : live;
  const open = pick.filter((a) => isLiveActivity(a.status)).sort((a, b) => {
    const oa = activityDue(a, nowMs).state === 'overdue' ? 0 : 1, ob = activityDue(b, nowMs).state === 'overdue' ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const ka = a.dueDate ?? '9999-12-31', kb = b.dueDate ?? '9999-12-31';
    return ka !== kb ? (ka < kb ? -1 : 1) : a.code.localeCompare(b.code);
  });
  const closed = pick.filter((a) => !isLiveActivity(a.status)).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '') || a.code.localeCompare(b.code));
  return [...open, ...closed];
}

/** El nombre del proyecto se compara sin mayúsculas ni espacios de más (la asignación y el hito lo escriben por separado). */
export const sameProject = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/** Validación de una actividad nueva: los mismos criterios del servidor (título 3–120, detalle ≤ 300 sin < ni >, técnico elegido, fecha no pasada). */
export function validateActivity(f: { title: string; description: string; tech: string | null; due: string }, today: string): { title?: true; description?: true; tech?: true; due?: true } {
  const e: { title?: true; description?: true; tech?: true; due?: true } = {};
  const title = f.title.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (title.length < 3 || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)) e.title = true;
  const d = f.description.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (d.length > 300 || /[<>\u0000-\u001f\u007f]/.test(d)) e.description = true;
  if (!f.tech) e.tech = true;
  if (f.due && (!/^\d{4}-\d{2}-\d{2}$/.test(f.due) || f.due < today)) e.due = true;
  return e;
}
