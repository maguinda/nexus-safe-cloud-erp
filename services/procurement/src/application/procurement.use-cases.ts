import { newItem, newSupplier, validateCatalogEntry } from '../domain/catalog';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors';
import { equipmentInstalled, equipmentPurchased, equipmentRetired, installNumber, orderNumber, stockChanged } from '../domain/events';
import { applyDelta, assertCancellable, assertReceivable, newOrder, validateAdjustment } from '../domain/order';
import { ProcurementCommands, ProcurementQueries, UnitOfWork } from '../domain/ports';

export class CreateSupplierUseCase {
  constructor(private readonly commands: ProcurementCommands) {}
  async execute(i: { name: unknown; kind: unknown; terms?: unknown; tenderRef?: unknown; validUntil?: unknown }) {
    const s = newSupplier(i.name, i.kind, i.terms, i.tenderRef, i.validUntil);
    if (!(await this.commands.insertSupplier(s))) throw new ConflictError('A supplier with that name already exists');
    return s;
  }
}
/** Lo que vende cada proveedor, con su precio de referencia y su plazo. */
export class SetCatalogUseCase {
  constructor(private readonly commands: ProcurementCommands) {}
  async execute(supplierId: string, itemId: string, input: { refPriceCop: unknown; leadDays: unknown }) {
    const v = validateCatalogEntry(input.refPriceCop, input.leadDays);
    if (!(await this.commands.setCatalog(supplierId, itemId, v.refPriceCop, v.leadDays))) throw new NotFoundError('Supplier or item');
    return { supplierId, itemId, ...v };
  }
  async remove(supplierId: string, itemId: string) {
    if (!(await this.commands.removeCatalog(supplierId, itemId))) throw new NotFoundError('Catalog entry');
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
  async execute(i: { supplierId: unknown; itemId: unknown; quantity: unknown; unitPriceCop?: unknown; projectName?: unknown }) {
    const priced = i.unitPriceCop !== undefined && i.unitPriceCop !== null;
    // Sin precio, se valida con uno provisional y se reemplaza por el de referencia del proveedor dentro de la transacción.
    const o = newOrder(i.supplierId, i.itemId, i.quantity, priced ? i.unitPriceCop : 1, i.projectName);
    return this.uow.run(async (tx) => {
      if ((await tx.supplierName(o.supplierId)) === null) throw new NotFoundError('Supplier');
      if ((await tx.lockItem(o.itemId)) === null) throw new NotFoundError('Item');
      // El proveedor solo vende lo de su catálogo.
      const ref = await tx.catalogPrice(o.supplierId, o.itemId);
      if (ref === null) throw new ConflictError('That supplier does not sell that item');
      const order = priced ? o : newOrder(o.supplierId, o.itemId, o.quantity, ref, o.projectName);
      const number = await tx.insertOrder(order);
      return { ...order, number };
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
      // Recibir un pedido crea la deuda con el proveedor (vence a 30 días), en la MISMA transacción: ni pedido recibido sin deuda ni deuda sin pedido recibido.
      await tx.createPayable(order.id, new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10));
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

/**
 * Instalar una unidad de un EQUIPO: pasa de «en bodega» (stock) a «instalado» (activo de la empresa). Baja 1 del stock (nunca bajo 0), anota el movimiento y publica
 * StockChanged y EquipmentInstalled en la MISMA transacción; Operations da de alta la unidad en el inventario de red. El artículo se bloquea y se relee dentro del bloqueo.
 */
export class InstallEquipmentUseCase {
  constructor(private readonly uow: UnitOfWork, private readonly clock: () => Date = () => new Date()) {}
  execute(itemId: string, correlationId: string, actor: string | null = null) {
    return this.uow.run(async (tx) => {
      const item = await tx.lockItem(itemId);
      if (!item) throw new NotFoundError('Item');
      if (item.kind !== 'equipment') throw new ConflictError(`${item.name} is a spare part: only equipment can be installed`);
      const onHand = applyDelta(item.onHand, -1, item.name);
      const now = this.clock();
      const inst = await tx.insertInstall({ itemId: item.id, itemName: item.name, actor });
      const label = installNumber(inst.number);
      await tx.setOnHand(item.id, onHand);
      await tx.addMovement({ itemId: item.id, itemName: item.name, delta: -1, onHandAfter: onHand, source: 'install', reason: `Instalación ${label}`, actor });
      await tx.addToOutbox(stockChanged(item, -1, onHand, 'installation', `install ${label}`, correlationId, now), `${inst.id}:stock`);
      await tx.addToOutbox(equipmentInstalled({ number: inst.number, itemId: item.id, itemName: item.name }, correlationId, now), `${inst.id}:installed`);
      return { installNumber: label, itemName: item.name, onHand };
    });
  }
}

/**
 * Una unidad instalada deja de estarlo: vuelve a la bodega (el stock sube 1) o se da de baja (el stock no cambia). Se bloquea primero la INSTALACIÓN y luego el artículo
 * (instalar solo bloquea el artículo y crea una fila nueva, así que no se forma ningún ciclo). El estado se relee dentro del bloqueo: devolver dos veces la misma unidad
 * la devuelve una sola vez (el segundo recibe 409). Operations quita el activo de Red al recibir EquipmentRetired.
 */
export class RetireInstalledUseCase {
  constructor(private readonly uow: UnitOfWork, private readonly clock: () => Date = () => new Date()) {}
  execute(installId: string, destination: unknown, correlationId: string, actor: string | null = null) {
    if (destination !== 'storage' && destination !== 'retired') throw new ValidationError('destination must be storage or retired');
    return this.uow.run(async (tx) => {
      const inst = await tx.lockInstall(installId);
      if (!inst) throw new NotFoundError('Installation');
      if (inst.status !== 'installed') throw new ConflictError(`${installNumber(inst.number)} is already ${inst.status}`);
      const item = await tx.lockItem(inst.itemId);
      if (!item) throw new NotFoundError('Item');
      const now = this.clock();
      const label = installNumber(inst.number);
      let onHand = item.onHand;
      if (destination === 'storage') {
        onHand = applyDelta(item.onHand, 1, item.name);
        await tx.setOnHand(item.id, onHand);
        await tx.addMovement({ itemId: item.id, itemName: item.name, delta: 1, onHandAfter: onHand, source: 'return', reason: `Devolución ${label}`, actor });
        await tx.addToOutbox(stockChanged(item, 1, onHand, 'return', `return ${label}`, correlationId, now), `${inst.id}:return-stock`);
      }
      await tx.endInstall(inst.id, destination === 'storage' ? 'returned' : 'retired', actor);
      await tx.addToOutbox(equipmentRetired({ number: inst.number, itemId: item.id, itemName: item.name }, destination, correlationId, now), `${inst.id}:retired`);
      return { installNumber: label, itemName: item.name, destination, onHand };
    });
  }
}

export class ListInstallsUseCase {
  constructor(private readonly q: ProcurementQueries) {}
  execute(opts: { itemId?: string; limit: number }) { return this.q.installs(opts); }
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
