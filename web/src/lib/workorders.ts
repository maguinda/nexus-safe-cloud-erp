import type { TFn } from '../i18n';

export const WO_TYPES = ['inspection', 'preventive', 'corrective'] as const;
export const WO_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type WoType = (typeof WO_TYPES)[number];
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u001f<>]/;
export interface WoForm { type: string; priority: string; description: string; dueDate: string; assignedTo: string }
export type WoErrors = Partial<Record<keyof WoForm, string>>;

/** Mismos criterios que el servidor (domain/work-order.ts): tipo de la lista, descripción de 3 a 300, fecha real que no sea pasada, responsable de 2 a 80. */
export function checkWorkOrder(t: TFn, f: WoForm, today: string): { errors: WoErrors; value?: { type: string; priority: string; description: string; dueDate?: string; assignedTo?: string } } {
  const errors: WoErrors = {};
  if (!(WO_TYPES as readonly string[]).includes(f.type)) errors.type = t('wo.v.type');
  if (!(WO_PRIORITIES as readonly string[]).includes(f.priority)) errors.priority = t('wo.v.priority');
  const d = f.description.replace(/\s+/g, ' ').trim();
  if (d.length < 3 || d.length > 300 || BAD.test(f.description.replace(/\s/g, ' '))) errors.description = t('wo.v.description');
  const due = f.dueDate.trim();
  if (due) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || new Date(`${due}T00:00:00Z`).toISOString().slice(0, 10) !== due || due > '2100-12-31') errors.dueDate = t('wo.v.date');
    else if (due < today) errors.dueDate = t('wo.v.datePast');
  }
  const who = f.assignedTo.replace(/\s+/g, ' ').trim();
  if (who && (who.length < 2 || who.length > 80 || BAD.test(who))) errors.assignedTo = t('wo.v.person');
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { type: f.type, priority: f.priority, description: d, ...(due ? { dueDate: due } : {}), ...(who ? { assignedTo: who } : {}) } };
}

export interface CapForm { percent: string; start: string; end: string; allowOver: boolean }
export const MAX_CAPACITY_DAYS = 1095;
/** Mismos criterios que el servidor: con un responsable de la lista, porcentaje entero de 1 a 100 y fechas reales (el fin no antes del inicio, hasta 1.095 días). */
export function checkCapacity(t: TFn, f: CapForm): { error?: string; value?: { capacityPercent: number; capacityStart: string; capacityEnd: string; allowOverallocation?: true } } {
  const p = f.percent.trim();
  if (!/^\d{1,3}$/.test(p) || Number(p) < 1 || Number(p) > 100) return { error: t('wo.v.capPercent') };
  const real = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d && d >= '2000-01-01' && d <= '2100-12-31';
  if (!real(f.start) || !real(f.end)) return { error: t('wo.v.capDates') };
  if (f.end < f.start) return { error: t('wo.v.capOrder') };
  if ((Date.parse(`${f.end}T00:00:00Z`) - Date.parse(`${f.start}T00:00:00Z`)) / 86_400_000 + 1 > MAX_CAPACITY_DAYS) return { error: t('wo.v.capSpan') };
  return { value: { capacityPercent: Number(p), capacityStart: f.start, capacityEnd: f.end, ...(f.allowOver ? { allowOverallocation: true as const } : {}) } };
}
/** Fechas por omisión de la reserva: desde hoy hasta la fecha límite de la orden (o 5 días). */
export function defaultCapacity(today: string, due?: string): CapForm {
  const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  return { percent: '25', start: today, end: due && due >= today ? due : plus(today, 4), allowOver: false };
}
