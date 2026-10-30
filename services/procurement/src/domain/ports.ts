import { Item, Supplier } from './catalog';
import { ProcurementEvent } from './events';
import { NewOrder, OrderStatus } from './order';
import { ThresholdAlert } from './events';

export interface OrderView { id: string; number: string; supplierId: string; supplierName: string; itemId: string; itemName: string; itemKind: string; quantity: number; unitPriceCop: number; totalCop: number; status: OrderStatus; createdAt: string; receivedAt: string | null }
export interface SuggestionView { eventId: string; deviceName: string; location: string; readingKind: string; status: string; value: number; unit: string; at: string; items: { id: string; name: string; onHand: number }[] }

/** Lecturas: no necesitan transacción. */
export interface NewMovement { itemId: string; itemName: string; delta: number; onHandAfter: number; source: 'purchase_received' | 'adjustment'; reason: string; actor: string | null }
export interface MovementView { id: string; itemId: string; itemName: string; delta: number; onHandAfter: number; source: string; reason: string; actor: string | null; at: string }
export interface ProcurementQueries {
  /** Más reciente primero; `itemId` filtra por artículo. */
  movements(opts: { itemId?: string; limit: number }): Promise<MovementView[]>;
  suppliers(): Promise<Supplier[]>;
  items(): Promise<Item[]>;
  orders(limit: number): Promise<OrderView[]>;
  /** Los últimos avisos de sensores con los repuestos que sirven para esa medida (los que tienen existencias primero). */
  suggestions(limit: number): Promise<SuggestionView[]>;
}
export interface ProcurementCommands {
  /** false si ya existe uno con ese nombre (sin importar mayúsculas). */
  insertSupplier(s: Supplier): Promise<boolean>;
  insertItem(i: Item): Promise<boolean>;
}

export interface LockedOrder { id: string; number: number; status: OrderStatus; supplierName: string; itemId: string; quantity: number; unitPriceCop: number; totalCop: number }
export interface TransactionScope {
  /** Bloquea el pedido (FOR UPDATE). null si no existe. */
  lockOrder(id: string): Promise<LockedOrder | null>;
  /** Bloquea el artículo (FOR UPDATE). null si no existe. */
  lockItem(id: string): Promise<Pick<Item, 'id' | 'name' | 'kind' | 'onHand'> | null>;
  supplierName(id: string): Promise<string | null>;
  insertOrder(o: NewOrder): Promise<number>;
  setOrderStatus(id: string, status: OrderStatus, receivedAt: Date | null): Promise<void>;
  setOnHand(itemId: string, onHand: number): Promise<void>;
  /** Anota el movimiento en el historial (misma transacción que `setOnHand`). */
  addMovement(m: NewMovement): Promise<void>;
  addToOutbox(event: ProcurementEvent, aggregateId: string): Promise<void>;
}
export interface UnitOfWork { run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> }

/** Lo que el consumidor hace en UNA transacción: marcar el evento y guardar la sugerencia. */
export interface EventScope {
  markEventProcessed(eventId: string): Promise<boolean>;
  addSuggestion(a: ThresholdAlert): Promise<void>;
}
export interface EventUnitOfWork { run<T>(work: (tx: EventScope) => Promise<T>): Promise<T> }
