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
