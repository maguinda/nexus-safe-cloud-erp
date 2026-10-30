import { InvalidEventError } from './errors';

export const EQUIPMENT_PURCHASED_ROUTING_KEY = 'procurement.equipment.purchased';
export const MAX_UNITS = 100;
const ORDER = /^PO-\d{4,9}$/;
const NAME = /^[^<>\u0000-\u001f]{1,100}$/u;
const SERVER_NAME = /^[^<>\u0000-\u001f]{1,120}$/u;

/** Lo único que Operations toma de la compra: qué equipo, cuántas unidades y de qué orden (para no duplicar). */
export interface PurchasedEquipment { orderNumber: string; itemName: string; quantity: number }

export function parseEquipmentPurchased(raw: unknown): PurchasedEquipment {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('event must be an object');
  const e = raw as Record<string, any>;
  if (e.type !== 'EquipmentPurchased') throw new InvalidEventError('unexpected type');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  if (typeof d.orderNumber !== 'string' || !ORDER.test(d.orderNumber)) throw new InvalidEventError('orderNumber must look like PO-0001');
  const itemName = typeof d.itemName === 'string' ? d.itemName.replace(/\s+/g, ' ').trim() : '';
  if (!NAME.test(itemName) || !SERVER_NAME.test(itemName)) throw new InvalidEventError('itemName must be 1 to 100 characters without < > or control characters');
  // Una compra de más de 100 unidades de UN equipo no se vuelca sola al inventario de red: se rechaza (cola de mensajes muertos) para que una persona decida.
  if (typeof d.quantity !== 'number' || !Number.isInteger(d.quantity) || d.quantity < 1 || d.quantity > MAX_UNITS) throw new InvalidEventError(`quantity must be a whole number from 1 to ${MAX_UNITS}`);
  return { orderNumber: d.orderNumber, itemName, quantity: d.quantity };
}

/** Nombre único y legible de la unidad en el inventario: «Router edge (PO-0001-2)», sin «#» porque la búsqueda del inventario no admite ese carácter. */
export const unitName = (itemName: string, orderNumber: string, unit: number) => `${itemName} (${orderNumber}-${unit})`.slice(0, 120);
