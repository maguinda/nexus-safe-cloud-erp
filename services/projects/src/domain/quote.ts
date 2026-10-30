import { InvalidInputError, QuoteStateError } from './errors';
import { cleanText, MAX_MILESTONE_AMOUNT_COP } from './project';

export const LINE_CATEGORIES = ['materials', 'supplies', 'labor'] as const;
export type LineCategory = (typeof LINE_CATEGORIES)[number];
export const QUOTE_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const DEFAULT_MARGIN_PCT = 25;
export const MAX_MARGIN_PCT = 100;
/** Por debajo de este margen la cotización se marca para que gerencia lo vea antes de aprobar. */
export const LOW_MARGIN_PCT = 10;
export const MAX_MILESTONES = 30;
export const MAX_LINES = 40;
export const MAX_QUANTITY = 100_000;
export const MAX_UNIT_COST_COP = 1_000_000_000;
/** El contrato (Billing) guarda el monto en un entero de 32 bits. */
export const MAX_QUOTE_PRICE_COP = 2_000_000_000;

export interface QuoteLine { category: LineCategory; description: string; quantity: number; unitCostCop: number; ref: string | null }
export interface QuoteMilestoneContent { name: string; lines: QuoteLine[] }
export interface QuoteContent { client: string; projectName: string; marginPct: number; milestones: QuoteMilestoneContent[] }

export interface PricedMilestone { name: string; costCop: number; priceCop: number; byCategory: Record<LineCategory, number>; lines: (QuoteLine & { totalCop: number })[] }
export interface PricedQuote {
  milestones: PricedMilestone[]; byCategory: Record<LineCategory, number>;
  costCop: number; priceCop: number; profitCop: number; marginPct: number; lowMargin: boolean;
}

/** Precio = costo + margen sobre el costo (25 % → costo × 1,25), redondeado al peso (mitad hacia arriba) con enteros, sin decimales binarios. */
export const priceOf = (costCop: number, marginPct: number): number => Math.floor((costCop * (100 + marginPct) * 2 + 100) / 200);

/**
 * Costo, precio y ganancia de una cotización. El precio de cada hito se redondea solo y el del proyecto es la SUMA de los hitos:
 * así lo que se factura por hitos suma exactamente el contrato. Lanza si algún tope no se cumple.
 */
export function priceQuote(c: QuoteContent): PricedQuote {
  const zero = (): Record<LineCategory, number> => ({ materials: 0, supplies: 0, labor: 0 });
  const total = zero();
  const milestones = c.milestones.map((m): PricedMilestone => {
    const by = zero();
    const lines = m.lines.map((l) => { const totalCop = l.quantity * l.unitCostCop; by[l.category] += totalCop; return { ...l, totalCop }; });
    const costCop = by.materials + by.supplies + by.labor;
    const priceCop = priceOf(costCop, c.marginPct);
    if (priceCop > MAX_MILESTONE_AMOUNT_COP) throw new InvalidInputError(`The price of the milestone “${m.name}” cannot be more than ${MAX_MILESTONE_AMOUNT_COP} pesos`);
    for (const k of LINE_CATEGORIES) total[k] += by[k];
    return { name: m.name, costCop, priceCop, byCategory: by, lines };
  });
  const costCop = milestones.reduce((s, m) => s + m.costCop, 0);
  const priceCop = milestones.reduce((s, m) => s + m.priceCop, 0);
  if (priceCop > MAX_QUOTE_PRICE_COP) throw new InvalidInputError(`The price of the quote cannot be more than ${MAX_QUOTE_PRICE_COP} pesos`);
  return { milestones, byCategory: total, costCop, priceCop, profitCop: priceCop - costCop, marginPct: c.marginPct, lowMargin: c.marginPct < LOW_MARGIN_PCT };
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new InvalidInputError(`${field} must be a whole number between ${min} and ${max}`);
  return v;
}
function text(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string') throw new InvalidInputError(`${field} must be text`);
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > max) throw new InvalidInputError(`${field} must be 2 to ${max} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(t)) throw new InvalidInputError(`${field} has characters that are not allowed`);
  return t;
}

/** Valida el contenido completo que manda ventas. Nada del cliente se acepta sin revisar: categorías, cantidades, costos, tamaños y nombres. */
export function validateQuoteContent(i: Record<string, unknown>): QuoteContent {
  const client = text(i.client, 'client', 120), projectName = text(i.projectName, 'projectName', 120);
  const marginPct = i.marginPct === undefined || i.marginPct === null ? DEFAULT_MARGIN_PCT : int(i.marginPct, 'marginPct', 0, MAX_MARGIN_PCT);
  const ms = i.milestones === undefined || i.milestones === null ? [] : i.milestones;
  if (!Array.isArray(ms) || ms.length > MAX_MILESTONES) throw new InvalidInputError(`milestones must be a list of up to ${MAX_MILESTONES}`);
  const seen = new Set<string>();
  const milestones = ms.map((m, n): QuoteMilestoneContent => {
    if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new InvalidInputError(`milestone ${n + 1} must be an object`);
    const name = cleanText((m as any).name, `milestone ${n + 1} name`);
    if (seen.has(name.toLowerCase())) throw new InvalidInputError(`the milestone “${name}” is repeated`);
    seen.add(name.toLowerCase());
    const ls = (m as any).lines === undefined || (m as any).lines === null ? [] : (m as any).lines;
    if (!Array.isArray(ls) || ls.length > MAX_LINES) throw new InvalidInputError(`the lines of “${name}” must be a list of up to ${MAX_LINES}`);
    const lines = ls.map((l: any, k: number): QuoteLine => {
      if (typeof l !== 'object' || l === null || Array.isArray(l)) throw new InvalidInputError(`line ${k + 1} of “${name}” must be an object`);
      if (typeof l.category !== 'string' || !(LINE_CATEGORIES as readonly string[]).includes(l.category)) throw new InvalidInputError(`category must be one of: ${LINE_CATEGORIES.join(', ')}`);
      const ref = l.ref === undefined || l.ref === null || l.ref === '' ? null : text(l.ref, 'ref', 64);
      return { category: l.category as LineCategory, description: text(l.description, 'description', 120), quantity: int(l.quantity, 'quantity', 1, MAX_QUANTITY), unitCostCop: int(l.unitCostCop, 'unitCostCop', 1, MAX_UNIT_COST_COP), ref };
    });
    return { name, lines };
  });
  const content = { client, projectName, marginPct, milestones };
  priceQuote(content); // topes de precio por hito y por cotización
  return content;
}

/** Para pasar de borrador a «pendiente» la cotización debe tener al menos un hito y cada hito al menos una línea con costo. */
export function assertReadyToSubmit(c: QuoteContent): void {
  if (c.milestones.length === 0) throw new QuoteStateError('The quote needs at least one milestone');
  for (const m of c.milestones) if (m.lines.length === 0) throw new QuoteStateError(`The milestone “${m.name}” needs at least one cost line`);
}

export const quoteLabel = (n: number) => `COT-${String(n).padStart(4, '0')}`;
