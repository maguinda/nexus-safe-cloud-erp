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

export function checkOrder(t: TFn, f: { supplierId: string; itemId: string; quantity: string; price: string }): { errors: { supplier?: string; item?: string; quantity?: string; price?: string }; value?: { supplierId: string; itemId: string; quantity: number; unitPriceCop?: number } } {
  const errors: { supplier?: string; item?: string; quantity?: string; price?: string } = {};
  if (!f.supplierId) errors.supplier = t('proc.v.choose');
  if (!f.itemId) errors.item = t('proc.v.choose');
  const q = f.quantity.trim(); const p = f.price.trim();
  if (!/^\d+$/.test(q) || Number(q) < 1 || Number(q) > 100_000) errors.quantity = t('proc.v.quantity');
  // El precio es opcional: vacío = el precio de referencia del proveedor.
  if (p !== '' && (!/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 1_000_000_000)) errors.price = t('proc.v.price');
  if (!errors.quantity && !errors.price && p !== '' && Number(q) * Number(p) > MAX_TOTAL) errors.price = t('proc.v.total');
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { supplierId: f.supplierId, itemId: f.itemId, quantity: Number(q), ...(p === '' ? {} : { unitPriceCop: Number(p) }) } };
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

/** Lo que un proveedor vende: precio de referencia en pesos enteros y plazo de 0 a 365 días (como el servidor). */
export function checkCatalog(t: TFn, f: { price: string; days: string }): { errors: { price?: string; days?: string }; value?: { refPriceCop: number; leadDays: number } } {
  const errors: { price?: string; days?: string } = {};
  const p = f.price.trim(), d = f.days.trim();
  if (!/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 1_000_000_000) errors.price = t('proc.v.price');
  if (!/^\d{1,3}$/.test(d) || Number(d) > 365) errors.days = t('cat.v.days');
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { refPriceCop: Number(p), leadDays: Number(d) } };
}

/** Licitación: referencia de 2 a 40 caracteres y una fecha real de fin (ambas opcionales). */
export function checkTender(t: TFn, f: { ref: string; until: string }): { errors: { ref?: string; until?: string }; value?: { tenderRef?: string; validUntil?: string } } {
  const errors: { ref?: string; until?: string } = {};
  const r = f.ref.replace(/\s+/g, ' ').trim(), u = f.until.trim();
  if (r && (r.length < 2 || r.length > 40 || BAD.test(r))) errors.ref = t('cat.v.tenderRef');
  if (u && (!/^\d{4}-\d{2}-\d{2}$/.test(u) || new Date(`${u}T00:00:00Z`).toISOString().slice(0, 10) !== u || u < '2000-01-01' || u > '2100-12-31')) errors.until = t('cat.v.until');
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { ...(r ? { tenderRef: r } : {}), ...(u ? { validUntil: u } : {}) } };
}
