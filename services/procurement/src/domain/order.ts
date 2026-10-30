import { randomUUID } from 'crypto';
import { ConflictError, ValidationError } from './errors';

export const ORDER_STATUSES = ['ordered', 'received', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const MAX_STOCK = 1_000_000;
export const MAX_ORDER_TOTAL_COP = 2_000_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NewOrder { id: string; supplierId: string; itemId: string; quantity: number; unitPriceCop: number; totalCop: number }

/** `unitPriceCop` puede venir vacío: entonces el caso de uso pone el precio de referencia del proveedor para ese artículo. */
export function newOrder(supplierId: unknown, itemId: unknown, quantity: unknown, unitPriceCop: unknown): NewOrder {
  if (typeof supplierId !== 'string' || !UUID.test(supplierId)) throw new ValidationError('supplierId must be an id');
  if (typeof itemId !== 'string' || !UUID.test(itemId)) throw new ValidationError('itemId must be an id');
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) throw new ValidationError('quantity must be a whole number from 1 to 100000');
  if (typeof unitPriceCop !== 'number' || !Number.isInteger(unitPriceCop) || unitPriceCop < 1 || unitPriceCop > 1_000_000_000) throw new ValidationError('unitPriceCop must be a whole number of pesos from 1 to 1000000000');
  const totalCop = quantity * unitPriceCop;
  if (totalCop > MAX_ORDER_TOTAL_COP) throw new ValidationError(`the total of an order cannot pass ${MAX_ORDER_TOTAL_COP} pesos`);
  return { id: randomUUID(), supplierId: supplierId.toLowerCase(), itemId: itemId.toLowerCase(), quantity, unitPriceCop, totalCop };
}

/** Recibir un pedido solo sirve si sigue pendiente: recibirlo dos veces (un doble clic) o recibir uno cancelado no mueve el stock. */
export function assertReceivable(status: OrderStatus): void {
  if (status !== 'ordered') throw new ConflictError(`The order is already ${status}`);
}
export function assertCancellable(status: OrderStatus): void {
  if (status !== 'ordered') throw new ConflictError(`The order is already ${status}`);
}

/** El stock nunca baja de 0 ni pasa del tope. */
export function applyDelta(onHand: number, delta: number, itemName: string): number {
  const next = onHand + delta;
  if (next < 0) throw new ConflictError(`${itemName} has ${onHand} in stock: it cannot go down by ${-delta}`);
  if (next > MAX_STOCK) throw new ConflictError(`${itemName} cannot hold more than ${MAX_STOCK} units`);
  return next;
}

export function validateAdjustment(delta: unknown, reason: unknown): { delta: number; reason: string } {
  if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100_000) throw new ValidationError('delta must be a whole number other than 0, up to 100000 either way');
  if (typeof reason !== 'string') throw new ValidationError('reason must be text');
  const r = reason.trim().replace(/\s+/g, ' ');
  // eslint-disable-next-line no-control-regex
  if (r.length < 3 || r.length > 120 || /[\u0000-\u001f<>]/.test(r)) throw new ValidationError('reason must be 3 to 120 characters without < > or control characters');
  return { delta, reason: r };
}
