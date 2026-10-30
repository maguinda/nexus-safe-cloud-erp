import { newItem, newSupplier } from '../domain/catalog';
import { ConflictError, NotFoundError } from '../domain/errors';
import { equipmentPurchased, orderNumber, stockChanged } from '../domain/events';
import { applyDelta, assertCancellable, assertReceivable, newOrder, validateAdjustment } from '../domain/order';
import { ProcurementCommands, ProcurementQueries, UnitOfWork } from '../domain/ports';

export class CreateSupplierUseCase {
  constructor(private readonly commands: ProcurementCommands) {}
  async execute(i: { name: unknown; kind: unknown; terms?: unknown }) {
    const s = newSupplier(i.name, i.kind, i.terms);
    if (!(await this.commands.insertSupplier(s))) throw new ConflictError('A supplier with that name already exists');
    return s;
  }
}
export class CreateItemUseCase {
  constructor(private readonly commands: ProcurementCommands) {}
  async execute(i: { name: unknown; kind: unknown; forKinds?: unknown }) {
    const it = newItem(i.name, i.kind, i.forKinds);
    if (!(await this.commands.insertItem(it))) throw new ConflictError('An item with that name already exists');
    return it;
  }
}

/** Un pedido nace «pendiente» (`ordered`): comprar no mueve el stock, recibirlo sí. */
export class CreateOrderUseCase {
  constructor(private readonly uow: UnitOfWork) {}
  async execute(i: { supplierId: unknown; itemId: unknown; quantity: unknown; unitPriceCop: unknown }) {
    const o = newOrder(i.supplierId, i.itemId, i.quantity, i.unitPriceCop);
    return this.uow.run(async (tx) => {
      if ((await tx.supplierName(o.supplierId)) === null) throw new NotFoundError('Supplier');
      if ((await tx.lockItem(o.itemId)) === null) throw new NotFoundError('Item');
      const number = await tx.insertOrder(o);
      return { ...o, number };
    });
  }
}

/**
 * Recibir un pedido: sube el stock y publica StockChanged (y EquipmentPurchased si es equipo), todo en UNA transacción.
 * Se bloquea primero el PEDIDO y luego el ARTÍCULO (siempre en ese orden) y el estado se relee dentro del bloqueo:
 * dos clics a la vez sobre «Recibir» suben el stock UNA vez, y el segundo recibe 409.
 */
export class ReceiveOrderUseCase {
  constructor(private readonly uow: UnitOfWork, private readonly clock: () => Date = () => new Date()) {}
  execute(orderId: string, correlationId: string, actor: string | null = null) {
    return this.uow.run(async (tx) => {
      const order = await tx.lockOrder(orderId);
      if (!order) throw new NotFoundError('Order');
      assertReceivable(order.status);
      const item = await tx.lockItem(order.itemId);
      if (!item) throw new NotFoundError('Item');
      const onHand = applyDelta(item.onHand, order.quantity, item.name);
      const now = this.clock();
      await tx.setOnHand(item.id, onHand);
      await tx.addMovement({ itemId: item.id, itemName: item.name, delta: order.quantity, onHandAfter: onHand, source: 'purchase_received', reason: `Pedido ${orderNumber(order.number)} recibido`, actor });
      await tx.setOrderStatus(order.id, 'received', now);
      await tx.addToOutbox(stockChanged(item, order.quantity, onHand, 'purchase_received', `order ${order.number}`, correlationId, now), `${order.id}:stock`);
      if (item.kind === 'equipment') {
        await tx.addToOutbox(equipmentPurchased({ number: order.number, id: order.id, supplierName: order.supplierName, itemName: item.name, quantity: order.quantity, unitPriceCop: order.unitPriceCop, totalCop: order.totalCop }, correlationId, now), `${order.id}:purchase`);
      }
      return { id: order.id, status: 'received' as const, onHand };
    });
  }
}

export class CancelOrderUseCase {
  constructor(private readonly uow: UnitOfWork) {}
  execute(orderId: string) {
    return this.uow.run(async (tx) => {
      const order = await tx.lockOrder(orderId);
      if (!order) throw new NotFoundError('Order');
      assertCancellable(order.status);
      await tx.setOrderStatus(order.id, 'cancelled', null);
      return { id: order.id, status: 'cancelled' as const };
    });
  }
}

/** Ajuste manual de stock (conteo, merma, devolución): el stock NUNCA queda negativo; el artículo se bloquea y se relee dentro del bloqueo. */
export class AdjustStockUseCase {
  constructor(private readonly uow: UnitOfWork, private readonly clock: () => Date = () => new Date()) {}
  execute(itemId: string, input: { delta: unknown; reason: unknown }, correlationId: string, actor: string | null = null) {
    const { delta, reason } = validateAdjustment(input.delta, input.reason);
    return this.uow.run(async (tx) => {
      const item = await tx.lockItem(itemId);
      if (!item) throw new NotFoundError('Item');
      const onHand = applyDelta(item.onHand, delta, item.name);
      await tx.setOnHand(item.id, onHand);
      await tx.addMovement({ itemId: item.id, itemName: item.name, delta, onHandAfter: onHand, source: 'adjustment', reason, actor });
      await tx.addToOutbox(stockChanged(item, delta, onHand, 'adjustment', reason, correlationId, this.clock()), `${item.id}:${correlationId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);
      return { id: item.id, onHand };
    });
  }
}

export class ListMovementsUseCase {
  constructor(private readonly q: ProcurementQueries) {}
  execute(opts: { itemId?: string; limit: number }) { return this.q.movements(opts); }
}

export class ListProcurementUseCase {
  constructor(private readonly q: ProcurementQueries) {}
  suppliers() { return this.q.suppliers(); }
  inventory() { return this.q.items(); }
  orders() { return this.q.orders(200); }
  suggestions() { return this.q.suggestions(20); }
}
