import type { MsgKey, TFn } from '../i18n';

/** Mismos criterios que el servidor (services/procurement). */
export const NAME_MAX = 80;
export const TERMS_MAX = 200;
export const REASON_MAX = 120;
export const MAX_TOTAL = 2_000_000_000;
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u001f<>]/;

export function checkName(t: TFn, raw: string, field: MsgKey, min: number, max: number): string {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (v.length < min) return t('proc.v.short', { field: t(field), min });
  if (v.length > max) return t('proc.v.long', { field: t(field), max });
  if (BAD.test(raw.replace(/\s/g, ' '))) return t('proc.v.chars', { field: t(field) });
  return '';
}

/** «TEMP, humidity ,temp» → ['TEMP', 'HUMIDITY']: separa por comas, pasa a mayúsculas y quita repetidas. */
export function parseKinds(raw: string): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const part of raw.split(',')) { const k = part.replace(/\s+/g, ' ').trim().toUpperCase(); if (k && !seen.has(k)) { seen.add(k); out.push(k); } }
  return out;
}

export function checkOrder(t: TFn, f: { supplierId: string; itemId: string; quantity: string; price: string }): { errors: { supplier?: string; item?: string; quantity?: string; price?: string }; value?: { supplierId: string; itemId: string; quantity: number; unitPriceCop: number } } {
  const errors: { supplier?: string; item?: string; quantity?: string; price?: string } = {};
  if (!f.supplierId) errors.supplier = t('proc.v.choose');
  if (!f.itemId) errors.item = t('proc.v.choose');
  const q = f.quantity.trim(); const p = f.price.trim();
  if (!/^\d+$/.test(q) || Number(q) < 1 || Number(q) > 100_000) errors.quantity = t('proc.v.quantity');
  if (!/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 1_000_000_000) errors.price = t('proc.v.price');
  if (!errors.quantity && !errors.price && Number(q) * Number(p) > MAX_TOTAL) errors.price = t('proc.v.total');
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { supplierId: f.supplierId, itemId: f.itemId, quantity: Number(q), unitPriceCop: Number(p) } };
}

export function checkAdjust(t: TFn, f: { delta: string; reason: string }): { errors: { delta?: string; reason?: string }; value?: { delta: number; reason: string } } {
  const errors: { delta?: string; reason?: string } = {};
  const d = f.delta.trim().replace('−', '-');
  if (!/^[+-]?\d+$/.test(d) || Number(d) === 0 || Math.abs(Number(d)) > 100_000) errors.delta = t('proc.v.delta');
  const r = f.reason.replace(/\s+/g, ' ').trim();
  if (r.length < 3 || r.length > REASON_MAX || BAD.test(f.reason.replace(/\s/g, ' '))) errors.reason = t('proc.v.reason');
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { delta: Number(d), reason: r } };
}
