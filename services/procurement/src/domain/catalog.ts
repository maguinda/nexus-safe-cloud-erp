import { randomUUID } from 'crypto';
import { ValidationError } from './errors';

export const SUPPLIER_KINDS = ['fixed', 'tender'] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];
export const ITEM_KINDS = ['equipment', 'spare'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface Supplier { id: string; name: string; kind: SupplierKind; terms: string; tenderRef: string | null; validUntil: string | null }
export interface CatalogEntry { itemId: string; itemName: string; itemKind: string; refPriceCop: number; leadDays: number }
export type SupplierView = Supplier & { catalog: CatalogEntry[] }
export interface Item { id: string; name: string; kind: ItemKind; forKinds: string[]; onHand: number }

// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u001f<>]/;
function text(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length < min || t.length > max) throw new ValidationError(`${field} must be ${min} to ${max} characters`);
  if (BAD.test(t)) throw new ValidationError(`${field} has characters that are not allowed`);
  return t;
}
function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new ValidationError(`${field} must be one of: ${list.join(', ')}`);
  return v as T;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function newSupplier(name: unknown, kind: unknown, terms: unknown, tenderRef?: unknown, validUntil?: unknown): Supplier {
  const k = oneOf(kind, SUPPLIER_KINDS, 'kind');
  const empty = (v: unknown) => v === undefined || v === null || v === '';
  if (k !== 'tender' && (!empty(tenderRef) || !empty(validUntil))) throw new ValidationError('tenderRef and validUntil only apply to suppliers by tender');
  let until: string | null = null;
  if (!empty(validUntil)) {
    if (typeof validUntil !== 'string' || !DAY.test(validUntil) || new Date(`${validUntil}T00:00:00Z`).toISOString().slice(0, 10) !== validUntil || validUntil < '2000-01-01' || validUntil > '2100-12-31') throw new ValidationError('validUntil must be a real date (YYYY-MM-DD)');
    until = validUntil;
  }
  return { tenderRef: empty(tenderRef) ? null : text(tenderRef, 'tenderRef', 2, 40), validUntil: until, ...baseSupplier(name, k, terms) };
}
function baseSupplier(name: unknown, kind: SupplierKind, terms: unknown): Omit<Supplier, 'tenderRef' | 'validUntil'> {
  return { id: randomUUID(), name: text(name, 'name', 2, 80), kind, terms: terms === undefined || terms === null || terms === '' ? '' : text(terms, 'terms', 2, 200) };
}

/** `forKinds`: las medidas de sensor (TEMP, HUMIDITY…) para las que sirve este repuesto: con ellas se sugiere cuando un sensor se pone en alerta. */
export function newItem(name: unknown, kind: unknown, forKinds: unknown): Item {
  let kinds: string[] = [];
  if (forKinds !== undefined && forKinds !== null) {
    if (!Array.isArray(forKinds) || forKinds.length > 10) throw new ValidationError('forKinds must be a list of up to 10 items');
    const seen = new Set<string>();
    for (const x of forKinds) { const k = text(x, 'forKinds', 2, 30).toUpperCase(); if (!seen.has(k)) { seen.add(k); kinds.push(k); } }
  }
  return { id: randomUUID(), name: text(name, 'name', 2, 80), kind: oneOf(kind, ITEM_KINDS, 'kind'), forKinds: kinds, onHand: 0 };
}

/** Qué cuesta (referencia) y en cuántos días entrega un proveedor un artículo. */
export function validateCatalogEntry(refPriceCop: unknown, leadDays: unknown): { refPriceCop: number; leadDays: number } {
  if (typeof refPriceCop !== 'number' || !Number.isInteger(refPriceCop) || refPriceCop < 1 || refPriceCop > 1_000_000_000) throw new ValidationError('refPriceCop must be a whole number of pesos from 1 to 1000000000');
  if (typeof leadDays !== 'number' || !Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) throw new ValidationError('leadDays must be a whole number from 0 to 365');
  return { refPriceCop, leadDays };
}
