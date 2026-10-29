import type { MsgKey, TFn } from '../i18n';
import type { AllocationInput } from './types';

/** Mismos criterios que el servidor (services/technical-capacity): proyecto de 2 a 80 caracteres sin < > ni control, 1 a 100 %, fechas reales con el fin igual o después del inicio y hasta 1095 días. */
export const MAX_SPAN_DAYS = 1095;
export const PROJECT_MAX = 80;
export const NAME_MAX = 80;
export const ROLE_MAX = 60;
export const TAG_MAX = 40;
export const CERT_MAX = 60;
export const TAGS_MAX = 20;

// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u001f<>]/;

/** «Cisco, SD-WAN ,cisco» → ['Cisco', 'SD-WAN']: separa por comas, recorta y quita repetidas sin importar mayúsculas. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const part of raw.split(',')) {
    const t = part.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

export function dayNumber(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (y < 2000 || y > 2100 || back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

export function checkLabel(t: TFn, raw: string, field: MsgKey, min: number, max: number): string {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (v.length < min) return t('capacity.v.short', { field: t(field), min });
  if (v.length > max) return t('capacity.v.long', { field: t(field), max });
  if (BAD.test(raw.replace(/\s/g, ' '))) return t('capacity.v.chars', { field: t(field) });
  return '';
}

export function checkTags(t: TFn, raw: string, field: MsgKey, max: number): string {
  const tags = parseTags(raw);
  if (tags.length > TAGS_MAX) return t('capacity.v.tagsMany', { field: t(field), max: TAGS_MAX });
  for (const x of tags) { const e = checkLabel(t, x, field, 2, max); if (e) return e; }
  return '';
}

export interface AllocationErrors { project?: string; percent?: string; start?: string; end?: string }

/** Devuelve los errores por campo (vacío = válido) y, si es válido, lo que se envía. */
export function checkAllocation(t: TFn, f: { project: string; percent: string; start: string; end: string }): { errors: AllocationErrors; value?: Omit<AllocationInput, 'allowOverallocation'> } {
  const errors: AllocationErrors = {};
  const project = checkLabel(t, f.project, 'capacity.field.project', 2, PROJECT_MAX);
  if (project) errors.project = project;
  const p = f.percent.trim();
  if (!/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 100) errors.percent = t('capacity.v.percent');
  const s = dayNumber(f.start.trim()); const e = dayNumber(f.end.trim());
  if (s === null) errors.start = t('capacity.v.date');
  if (e === null) errors.end = t('capacity.v.date');
  if (s !== null && e !== null) {
    if (e < s) errors.end = t('capacity.v.order');
    else if (e - s + 1 > MAX_SPAN_DAYS) errors.end = t('capacity.v.span', { max: MAX_SPAN_DAYS });
  }
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { projectName: f.project.replace(/\s+/g, ' ').trim(), percent: Number(p), startDate: f.start.trim(), endDate: f.end.trim() } };
}
