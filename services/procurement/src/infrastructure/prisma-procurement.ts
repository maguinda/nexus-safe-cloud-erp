import { Prisma, PrismaClient } from '@prisma/client';
import { Item, Supplier } from '../domain/catalog';
import { ProcurementEvent, orderNumber, routingKeyOf, ThresholdAlert } from '../domain/events';
import { NewOrder, OrderStatus } from '../domain/order';
import { EventScope, EventUnitOfWork, LockedOrder, OrderView, ProcurementCommands, ProcurementQueries, SuggestionView, TransactionScope, UnitOfWork } from '../domain/ports';

const TX = { timeout: 10_000, maxWait: 10_000 };

export class PrismaProcurement implements ProcurementQueries, ProcurementCommands {
  constructor(private readonly prisma: PrismaClient) {}

  async insertSupplier(s: Supplier): Promise<boolean> {
    const n = await this.prisma.$executeRaw`INSERT INTO suppliers (id, name, kind, terms) VALUES (${s.id}::uuid, ${s.name}, ${s.kind}, ${s.terms}) ON CONFLICT ((lower(name))) DO NOTHING`;
    return n === 1;
  }
  async insertItem(i: Item): Promise<boolean> {
    const n = await this.prisma.$executeRaw`INSERT INTO items (id, name, kind, for_kinds) VALUES (${i.id}::uuid, ${i.name}, ${i.kind}, ${i.forKinds}::text[]) ON CONFLICT ((lower(name))) DO NOTHING`;
    return n === 1;
  }

  async suppliers(): Promise<Supplier[]> {
    const rows = await this.prisma.supplier.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind as Supplier['kind'], terms: r.terms }));
  }
  async items(): Promise<Item[]> {
    const rows = await this.prisma.item.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind as Item['kind'], forKinds: r.forKinds, onHand: r.onHand }));
  }
  async orders(limit: number): Promise<OrderView[]> {
    const rows = await this.prisma.purchaseOrder.findMany({ orderBy: [{ createdAt: 'desc' }, { number: 'desc' }], take: limit, include: { supplier: true, item: true } });
    return rows.map((r) => ({
      id: r.id, number: orderNumber(r.number), supplierId: r.supplierId, supplierName: r.supplier.name, itemId: r.itemId, itemName: r.item.name, itemKind: r.item.kind,
      quantity: r.quantity, unitPriceCop: r.unitPriceCop, totalCop: r.totalCop, status: r.status as OrderStatus, createdAt: r.createdAt.toISOString(), receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
    }));
  }
  async suggestions(limit: number): Promise<SuggestionView[]> {
    const alerts = await this.prisma.alertSuggestion.findMany({ orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: limit });
    const items = await this.prisma.item.findMany({ where: { kind: 'spare' }, orderBy: [{ onHand: 'desc' }, { name: 'asc' }] });
    return alerts.map((a) => ({
      eventId: a.eventId, deviceName: a.deviceName, location: a.location, readingKind: a.readingKind, status: a.status, value: a.value, unit: a.unit, at: a.occurredAt.toISOString(),
      items: items.filter((i) => i.forKinds.includes(a.readingKind)).map((i) => ({ id: i.id, name: i.name, onHand: i.onHand })),
    }));
  }
}

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new Scope(c)), TX);
  }
}

class Scope implements TransactionScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async lockOrder(id: string): Promise<LockedOrder | null> {
    // FOR UPDATE OF o: otro clic sobre el mismo pedido espera aquí y, al continuar, ya lo ve recibido o cancelado.
    const rows = await this.tx.$queryRaw<{ id: string; number: number; status: string; supplier_name: string; item_id: string; quantity: number; unit_price_cop: number; total_cop: number }[]>`
      SELECT o.id, o.number, o.status, s.name AS supplier_name, o.item_id, o.quantity, o.unit_price_cop, o.total_cop
      FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = ${id}::uuid FOR UPDATE OF o`;
    const r = rows[0];
    return r ? { id: r.id, number: r.number, status: r.status as OrderStatus, supplierName: r.supplier_name, itemId: r.item_id, quantity: r.quantity, unitPriceCop: r.unit_price_cop, totalCop: r.total_cop } : null;
  }
  async lockItem(id: string) {
    const rows = await this.tx.$queryRaw<{ id: string; name: string; kind: string; on_hand: number }[]>`SELECT id, name, kind, on_hand FROM items WHERE id = ${id}::uuid FOR UPDATE`;
    const r = rows[0];
    return r ? { id: r.id, name: r.name, kind: r.kind as Item['kind'], onHand: r.on_hand } : null;
  }
  async supplierName(id: string) {
    const r = await this.tx.supplier.findUnique({ where: { id }, select: { name: true } });
    return r ? r.name : null;
  }
  async insertOrder(o: NewOrder): Promise<number> {
    const rows = await this.tx.$queryRaw<{ number: number }[]>`
      INSERT INTO purchase_orders (id, supplier_id, item_id, quantity, unit_price_cop, total_cop) VALUES (${o.id}::uuid, ${o.supplierId}::uuid, ${o.itemId}::uuid, ${o.quantity}, ${o.unitPriceCop}, ${o.totalCop}) RETURNING number`;
    return rows[0].number;
  }
  async setOrderStatus(id: string, status: OrderStatus, receivedAt: Date | null) {
    await this.tx.$executeRaw`UPDATE purchase_orders SET status = ${status}, received_at = ${receivedAt} WHERE id = ${id}::uuid`;
  }
  async setOnHand(itemId: string, onHand: number) {
    await this.tx.$executeRaw`UPDATE items SET on_hand = ${onHand} WHERE id = ${itemId}::uuid`;
  }
  async addToOutbox(event: ProcurementEvent, aggregateId: string) {
    await this.tx.outboxEvent.create({ data: { id: event.eventId, aggregateId, type: event.type, routingKey: routingKeyOf(event), payload: event as unknown as Prisma.InputJsonValue } });
  }
}

export class PrismaEventUnitOfWork implements EventUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: EventScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new EScope(c)), TX);
  }
}

class EScope implements EventScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}
  async markEventProcessed(eventId: string): Promise<boolean> {
    const n = await this.tx.$executeRaw`INSERT INTO processed_events (event_id) VALUES (${eventId}::uuid) ON CONFLICT (event_id) DO NOTHING`;
    return n === 1;
  }
  async addSuggestion(a: ThresholdAlert): Promise<void> {
    await this.tx.alertSuggestion.create({ data: { eventId: a.eventId, deviceName: a.deviceName, location: a.location, readingKind: a.readingKind, status: a.status, value: a.value, unit: a.unit, occurredAt: a.occurredAt } });
    // Solo se guardan los últimos 200 avisos.
    await this.tx.$executeRaw`DELETE FROM alert_suggestions WHERE id <= (SELECT COALESCE(max(id), 0) - 200 FROM alert_suggestions)`;
  }
}
