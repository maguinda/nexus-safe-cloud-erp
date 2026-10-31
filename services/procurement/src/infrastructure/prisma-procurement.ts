import { Prisma, PrismaClient } from '@prisma/client';
import { Item, Supplier, SupplierView } from '../domain/catalog';
import { ProcurementEvent, installNumber, orderNumber, routingKeyOf, ThresholdAlert } from '../domain/events';
import { NewOrder, OrderStatus } from '../domain/order';
import { EventScope, EventUnitOfWork, InstallView, LockedOrder, MovementView, NewMovement, OrderView, ProcurementCommands, ProcurementQueries, SuggestionView, TransactionScope, UnitOfWork } from '../domain/ports';

const TX = { timeout: 10_000, maxWait: 10_000 };

export class PrismaProcurement implements ProcurementQueries, ProcurementCommands {
  constructor(private readonly prisma: PrismaClient) {}

  async insertSupplier(s: Supplier): Promise<boolean> {
    const n = await this.prisma.$executeRaw`INSERT INTO suppliers (id, name, kind, terms, tender_ref, valid_until) VALUES (${s.id}::uuid, ${s.name}, ${s.kind}, ${s.terms}, ${s.tenderRef}, ${s.validUntil}::date) ON CONFLICT ((lower(name))) DO NOTHING`;
    return n === 1;
  }
  async insertItem(i: Item): Promise<boolean> {
    const n = await this.prisma.$executeRaw`INSERT INTO items (id, name, kind, for_kinds) VALUES (${i.id}::uuid, ${i.name}, ${i.kind}, ${i.forKinds}::text[]) ON CONFLICT ((lower(name))) DO NOTHING`;
    return n === 1;
  }

  async setCatalog(supplierId: string, itemId: string, refPriceCop: number, leadDays: number): Promise<boolean> {
    try {
      const n = await this.prisma.$executeRaw`
        INSERT INTO supplier_items (supplier_id, item_id, ref_price_cop, lead_days) VALUES (${supplierId}::uuid, ${itemId}::uuid, ${refPriceCop}, ${leadDays})
        ON CONFLICT (supplier_id, item_id) DO UPDATE SET ref_price_cop = EXCLUDED.ref_price_cop, lead_days = EXCLUDED.lead_days`;
      return n === 1;
    } catch (e: any) { if (/supplier_items_(supplier|item)_fk|foreign key/i.test(String(e?.message))) return false; throw e; }
  }
  async removeCatalog(supplierId: string, itemId: string): Promise<boolean> {
    return (await this.prisma.$executeRaw`DELETE FROM supplier_items WHERE supplier_id = ${supplierId}::uuid AND item_id = ${itemId}::uuid`) === 1;
  }
  async suppliers(): Promise<SupplierView[]> {
    const rows = await this.prisma.supplier.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    const cat = await this.prisma.$queryRaw<{ supplier_id: string; item_id: string; item_name: string; item_kind: string; ref_price_cop: number; lead_days: number }[]>`
      SELECT si.supplier_id, si.item_id, i.name AS item_name, i.kind AS item_kind, si.ref_price_cop, si.lead_days FROM supplier_items si JOIN items i ON i.id = si.item_id ORDER BY i.name, i.id`;
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind as Supplier['kind'], terms: r.terms, tenderRef: r.tenderRef, validUntil: r.validUntil ? r.validUntil.toISOString().slice(0, 10) : null,
      catalog: cat.filter((c) => c.supplier_id === r.id).map((c) => ({ itemId: c.item_id, itemName: c.item_name, itemKind: c.item_kind, refPriceCop: c.ref_price_cop, leadDays: c.lead_days })) }));
  }
  async installs(opts: { itemId?: string; limit: number }): Promise<InstallView[]> {
    const rows = await this.prisma.equipmentInstall.findMany({ where: opts.itemId ? { itemId: opts.itemId } : {}, orderBy: [{ number: 'desc' }], take: opts.limit });
    return rows.map((r) => ({ id: r.id, number: installNumber(r.number), itemId: r.itemId, itemName: r.itemName, status: r.status, installedAt: r.installedAt.toISOString(), installedBy: r.installedBy, endedAt: r.endedAt ? r.endedAt.toISOString() : null, endedBy: r.endedBy }));
  }
  async movements(opts: { itemId?: string; limit: number }): Promise<MovementView[]> {
    const rows = await this.prisma.stockMovement.findMany({ where: opts.itemId ? { itemId: opts.itemId } : {}, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: opts.limit });
    return rows.map((r) => ({ id: r.id, itemId: r.itemId, itemName: r.itemName, delta: r.delta, onHandAfter: r.onHandAfter, source: r.source, reason: r.reason, actor: r.actor, at: r.createdAt.toISOString() }));
  }
  async items(): Promise<Item[]> {
    const rows = await this.prisma.item.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind as Item['kind'], forKinds: r.forKinds, onHand: r.onHand }));
  }
  async orders(limit: number): Promise<OrderView[]> {
    const rows = await this.prisma.purchaseOrder.findMany({ orderBy: [{ createdAt: 'desc' }, { number: 'desc' }], take: limit, include: { supplier: true, item: true } });
    return rows.map((r) => ({
      id: r.id, number: orderNumber(r.number), supplierId: r.supplierId, supplierName: r.supplier.name, itemId: r.itemId, itemName: r.item.name, itemKind: r.item.kind,
      quantity: r.quantity, unitPriceCop: r.unitPriceCop, totalCop: r.totalCop, projectName: r.projectName, status: r.status as OrderStatus, createdAt: r.createdAt.toISOString(), receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
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
  async catalogPrice(supplierId: string, itemId: string) {
    const r = await this.tx.$queryRaw<{ p: number }[]>`SELECT ref_price_cop AS p FROM supplier_items WHERE supplier_id = ${supplierId}::uuid AND item_id = ${itemId}::uuid`;
    return r[0] ? r[0].p : null;
  }
  async lockInstall(id: string) {
    const r = await this.tx.$queryRaw<{ id: string; number: number; item_id: string; item_name: string; status: string }[]>`SELECT id, number, item_id, item_name, status FROM equipment_installs WHERE id = ${id}::uuid FOR UPDATE`;
    return r[0] ? { id: r[0].id, number: r[0].number, itemId: r[0].item_id, itemName: r[0].item_name, status: r[0].status as 'installed' | 'returned' | 'retired' } : null;
  }
  async endInstall(id: string, status: 'returned' | 'retired', actor: string | null) {
    await this.tx.$executeRaw`UPDATE equipment_installs SET status = ${status}, ended_at = now(), ended_by = ${actor} WHERE id = ${id}::uuid`;
  }
  async insertInstall(i: { itemId: string; itemName: string; actor: string | null }) {
    const r = await this.tx.$queryRaw<{ id: string; number: number }[]>`INSERT INTO equipment_installs (item_id, item_name, installed_by) VALUES (${i.itemId}::uuid, ${i.itemName}, ${i.actor}) RETURNING id, number`;
    return r[0];
  }
  async supplierName(id: string) {
    const r = await this.tx.supplier.findUnique({ where: { id }, select: { name: true } });
    return r ? r.name : null;
  }
  async insertOrder(o: NewOrder): Promise<number> {
    const rows = await this.tx.$queryRaw<{ number: number }[]>`
      INSERT INTO purchase_orders (id, supplier_id, item_id, quantity, unit_price_cop, total_cop, project_name) VALUES (${o.id}::uuid, ${o.supplierId}::uuid, ${o.itemId}::uuid, ${o.quantity}, ${o.unitPriceCop}, ${o.totalCop}, ${o.projectName}) RETURNING number`;
    return rows[0].number;
  }
  async createPayable(orderId: string, dueDate: string) {
    await this.tx.$executeRaw`INSERT INTO payables (order_id, supplier_name, amount_cop, due_date, project_name)
      SELECT o.id, s.name, o.total_cop, ${dueDate}::date, o.project_name FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = ${orderId}::uuid
      ON CONFLICT (order_id) DO NOTHING`;
  }
  async setOrderStatus(id: string, status: OrderStatus, receivedAt: Date | null) {
    await this.tx.$executeRaw`UPDATE purchase_orders SET status = ${status}, received_at = ${receivedAt} WHERE id = ${id}::uuid`;
  }
  async setOnHand(itemId: string, onHand: number) {
    await this.tx.$executeRaw`UPDATE items SET on_hand = ${onHand} WHERE id = ${itemId}::uuid`;
  }
  async addMovement(m: NewMovement) {
    await this.tx.stockMovement.create({ data: { itemId: m.itemId, itemName: m.itemName, delta: m.delta, onHandAfter: m.onHandAfter, source: m.source, reason: m.reason, actor: m.actor } });
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
