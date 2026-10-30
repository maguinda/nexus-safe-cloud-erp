import { randomUUID } from 'crypto';
import { InvalidEventError } from './errors';

/** Contrato en docs/events.md. Sin datos personales: nombres de negocio, cantidades y montos. */
interface Envelope { eventId: string; occurredAt: string; correlationId: string }
export interface EquipmentPurchasedEvent extends Envelope {
  type: 'EquipmentPurchased';
  data: { orderNumber: string; orderId: string; supplierName: string; itemName: string; quantity: number; unitPriceCop: number; totalCop: number };
}
export interface StockChangedEvent extends Envelope {
  type: 'StockChanged';
  data: { itemId: string; itemName: string; delta: number; onHand: number; reason: 'purchase_received' | 'adjustment' | 'installation'; note: string };
}
/** Una unidad de equipo pasó de «en bodega» a «instalada»: Operations la da de alta en el inventario de red. */
export interface EquipmentInstalledEvent extends Envelope {
  type: 'EquipmentInstalled';
  data: { installNumber: string; itemId: string; itemName: string };
}
export type ProcurementEvent = EquipmentPurchasedEvent | StockChangedEvent | EquipmentInstalledEvent;

export const EQUIPMENT_PURCHASED_ROUTING_KEY = 'procurement.equipment.purchased';
export const STOCK_CHANGED_ROUTING_KEY = 'procurement.stock.changed';
export const EQUIPMENT_INSTALLED_ROUTING_KEY = 'procurement.equipment.installed';
export const routingKeyOf = (e: ProcurementEvent): string => (e.type === 'EquipmentPurchased' ? EQUIPMENT_PURCHASED_ROUTING_KEY : e.type === 'EquipmentInstalled' ? EQUIPMENT_INSTALLED_ROUTING_KEY : STOCK_CHANGED_ROUTING_KEY);
export const installNumber = (n: number): string => `INS-${String(n).padStart(4, '0')}`;
/** Lo que este servicio ESCUCHA. */
export const ROUTING_KEYS = ['ops.threshold.breached'] as const;

export const orderNumber = (n: number): string => `PO-${String(n).padStart(4, '0')}`;

export function equipmentPurchased(o: { number: number; id: string; supplierName: string; itemName: string; quantity: number; unitPriceCop: number; totalCop: number }, correlationId: string, now: Date): EquipmentPurchasedEvent {
  return { eventId: randomUUID(), type: 'EquipmentPurchased', occurredAt: now.toISOString(), correlationId,
    data: { orderNumber: orderNumber(o.number), orderId: o.id, supplierName: o.supplierName, itemName: o.itemName, quantity: o.quantity, unitPriceCop: o.unitPriceCop, totalCop: o.totalCop } };
}
export function stockChanged(item: { id: string; name: string }, delta: number, onHand: number, reason: 'purchase_received' | 'adjustment' | 'installation', note: string, correlationId: string, now: Date): StockChangedEvent {
  return { eventId: randomUUID(), type: 'StockChanged', occurredAt: now.toISOString(), correlationId, data: { itemId: item.id, itemName: item.name, delta, onHand, reason, note } };
}

export function equipmentInstalled(i: { number: number; itemId: string; itemName: string }, correlationId: string, now: Date): EquipmentInstalledEvent {
  return { eventId: randomUUID(), type: 'EquipmentInstalled', occurredAt: now.toISOString(), correlationId, data: { installNumber: installNumber(i.number), itemId: i.itemId, itemName: i.itemName } };
}

// ---- Entrada: ThresholdBreached (lo publica operations; contrato en docs/events.md) ----
export interface ThresholdAlert { eventId: string; occurredAt: Date; deviceName: string; location: string; readingKind: string; status: string; value: number; unit: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function txt(v: unknown, f: string, max: number): string {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw new InvalidEventError(`${f} must be a non-empty string up to ${max} chars`);
  return v;
}
export function parseThreshold(raw: unknown): ThresholdAlert {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('body must be an object');
  const e = raw as Record<string, any>;
  if (e.type !== 'ThresholdBreached') throw new InvalidEventError('unknown event type');
  if (typeof e.eventId !== 'string' || !UUID.test(e.eventId)) throw new InvalidEventError('eventId must be a UUID');
  if (typeof e.occurredAt !== 'string' || Number.isNaN(Date.parse(e.occurredAt))) throw new InvalidEventError('occurredAt must be an ISO date');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  if (typeof d.value !== 'number' || !Number.isFinite(d.value) || Math.abs(d.value) > 1e9) throw new InvalidEventError('value must be a finite number');
  return { eventId: e.eventId.toLowerCase(), occurredAt: new Date(e.occurredAt), deviceName: txt(d.deviceName, 'deviceName', 120), location: txt(d.location, 'location', 120),
    readingKind: txt(d.readingKind, 'readingKind', 60).toUpperCase(), status: txt(d.status, 'status', 40), value: d.value, unit: txt(d.unit, 'unit', 20) };
}
