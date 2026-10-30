import { randomUUID } from 'crypto';
import { ValidationError } from './errors';

export const SUPPLIER_KINDS = ['fixed', 'tender'] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];
export const ITEM_KINDS = ['equipment', 'spare'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface Supplier { id: string; name: string; kind: SupplierKind; terms: string }
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

export function newSupplier(name: unknown, kind: unknown, terms: unknown): Supplier {
  return { id: randomUUID(), name: text(name, 'name', 2, 80), kind: oneOf(kind, SUPPLIER_KINDS, 'kind'), terms: terms === undefined || terms === null || terms === '' ? '' : text(terms, 'terms', 2, 200) };
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
