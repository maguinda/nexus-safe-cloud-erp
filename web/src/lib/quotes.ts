import type { TFn } from '../i18n';
import type { LineCategory, Quote } from './types';

export const LINE_CATEGORIES: readonly LineCategory[] = ['materials', 'supplies', 'labor'];
/** Mismos topes que el servidor (domain/quote.ts). */
export const MAX_MILESTONES = 30;
export const MAX_LINES = 40;
export const MAX_QUANTITY = 100_000;
export const MAX_UNIT_COST = 1_000_000_000;
export const MAX_MILESTONE_PRICE = 1_000_000_000;
export const MAX_QUOTE_PRICE = 2_000_000_000;
export const DEFAULT_MARGIN = 25;
const BAD = /[\u0000-\u001f\u007f<>]/;

/** Precio = costo + margen, redondeado al peso (mitad hacia arriba) con enteros: igual que el servidor. */
export const priceOf = (cost: number, margin: number): number => Math.floor((cost * (100 + margin) * 2 + 100) / 200);

export interface EditLine { category: LineCategory; description: string; quantity: string; unit: string; ref: string | null }
export interface EditMilestone { name: string; lines: EditLine[] }
export interface EditQuote { client: string; projectName: string; margin: string; milestones: EditMilestone[] }

export const toEdit = (q: Quote): EditQuote => ({
  client: q.client, projectName: q.projectName, margin: String(q.marginPct),
  milestones: q.milestones.map((m) => ({ name: m.name, lines: m.lines.map((l) => ({ category: l.category, description: l.description, quantity: String(l.quantity), unit: String(l.unitCostCop), ref: l.ref })) })),
});

const whole = (s: string): number | null => (/^\d{1,10}$/.test(s.trim()) ? Number(s.trim()) : null);
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const okName = (s: string, min = 2) => { const c = clean(s); return c.length >= min && c.length <= 120 && !BAD.test(c); };

/** Lo que se ve mientras se escribe: números inválidos cuentan como 0 (los avisos salen al guardar). */
export function preview(f: EditQuote): { milestones: { cost: number; price: number }[]; cost: number; price: number; profit: number } {
  const m = whole(f.margin) ?? DEFAULT_MARGIN;
  const milestones = f.milestones.map((x) => { const cost = x.lines.reduce((s, l) => s + (whole(l.quantity) ?? 0) * (whole(l.unit) ?? 0), 0); return { cost, price: priceOf(cost, Math.min(m, 100)) }; });
  const cost = milestones.reduce((s, x) => s + x.cost, 0), price = milestones.reduce((s, x) => s + x.price, 0);
  return { milestones, cost, price, profit: price - cost };
}

export function checkQuote(t: TFn, f: EditQuote, forSubmit: boolean): { errors: string[]; value?: { client: string; projectName: string; marginPct: number; milestones: { name: string; lines: { category: string; description: string; quantity: number; unitCostCop: number; ref?: string }[] }[] } } {
  const errors: string[] = [];
  if (!okName(f.client)) errors.push(t('q.v.client'));
  if (!okName(f.projectName)) errors.push(t('q.v.project'));
  const margin = whole(f.margin);
  if (margin === null || margin > 100) errors.push(t('q.v.margin'));
  const seen = new Set<string>();
  const milestones = f.milestones.map((m, i) => {
    const name = clean(m.name);
    if (!okName(m.name, 1)) errors.push(t('q.v.milestoneName', { n: i + 1 }));
    else if (seen.has(name.toLowerCase())) errors.push(t('q.v.milestoneRepeat', { name }));
    seen.add(name.toLowerCase());
    const lines = m.lines.map((l, k) => {
      const q = whole(l.quantity), u = whole(l.unit);
      if (!okName(l.description)) errors.push(t('q.v.desc', { m: i + 1, l: k + 1 }));
      if (q === null || q < 1 || q > MAX_QUANTITY) errors.push(t('q.v.qty', { m: i + 1, l: k + 1 }));
      if (u === null || u < 1 || u > MAX_UNIT_COST) errors.push(t('q.v.unit', { m: i + 1, l: k + 1 }));
      return { category: l.category, description: clean(l.description), quantity: q ?? 0, unitCostCop: u ?? 0, ...(l.ref ? { ref: l.ref } : {}) };
    });
    return { name, lines };
  });
  if (errors.length === 0) {
    const p = preview(f);
    p.milestones.forEach((m, i) => { if (m.price > MAX_MILESTONE_PRICE) errors.push(t('q.v.milestonePrice', { n: i + 1 })); });
    if (p.price > MAX_QUOTE_PRICE) errors.push(t('q.v.total'));
  }
  if (forSubmit && (f.milestones.length === 0 || f.milestones.some((m) => m.lines.length === 0))) errors.push(t('q.v.empty'));
  return errors.length ? { errors } : { errors, value: { client: clean(f.client), projectName: clean(f.projectName), marginPct: margin as number, milestones } };
}
