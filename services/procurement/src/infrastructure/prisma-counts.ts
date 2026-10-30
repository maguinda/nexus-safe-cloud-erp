import { Prisma, PrismaClient } from '@prisma/client';
import { CountLine, planClose, validateCounted } from '../domain/count';
import { ConflictError, NotFoundError } from '../domain/errors';
import { routingKeyOf, stockChanged } from '../domain/events';

const TX = { timeout: 20_000, maxWait: 20_000 };
type Tx = Prisma.TransactionClient;
export interface CountView { id: string; number: number; status: string; openedBy: string | null; openedAt: string; closedBy: string | null; closedAt: string | null; lines: number; counted: number; differences: number }
export interface CountLineView { itemId: string; itemName: string; expected: number; counted: number | null; variance: number | null; appliedDelta: number | null }

/**
 * Conteo físico. Orden de bloqueos (siempre el mismo): el CONTEO y luego los ARTÍCULOS por id. Recibir un pedido bloquea pedido → artículo y un ajuste solo el artículo,
 * así que no se forma ningún ciclo. El estado del conteo y el stock se releen DENTRO del bloqueo: cerrar dos veces o cerrar mientras se anota una línea no se pisan.
 */
export class CountsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async lockCount(tx: Tx, id: string): Promise<{ id: string; number: number; status: string }> {
    const rows = await tx.$queryRaw<{ id: string; number: number; status: string }[]>`SELECT id, number, status FROM stock_counts WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new NotFoundError('Count');
    return rows[0];
  }
  private assertOpen(c: { status: string }) { if (c.status !== 'open') throw new ConflictError(`The count is already ${c.status}`); }

  async open(actor: string | null): Promise<CountView> {
    return this.prisma.$transaction(async (tx) => {
      let id: string;
      try { id = (await tx.$queryRaw<{ id: string }[]>`INSERT INTO stock_counts (opened_by) VALUES (${actor}) RETURNING id`)[0].id; } catch (e: any) {
        if (/stock_counts_one_open_key|duplicate key/i.test(String(e?.message)) || e?.code === 'P2010' || e?.code === 'P2002') throw new ConflictError('There is already an open count: close or cancel it first');
        throw e;
      }
      // La foto del stock se toma con los artículos bloqueados contra escritura (en orden de id), para que sea una foto de un solo instante.
      await tx.$executeRaw`
        INSERT INTO stock_count_lines (count_id, item_id, item_name, expected)
        SELECT ${id}::uuid, i.id, i.name, i.on_hand FROM (SELECT id, name, on_hand FROM items ORDER BY id FOR SHARE) i`;
      return this.view(tx, id);
    }, TX);
  }

  async setCounted(countId: string, itemId: string, counted: unknown, actor: string | null): Promise<CountLineView> {
    const value = validateCounted(counted);
    return this.prisma.$transaction(async (tx) => {
      this.assertOpen(await this.lockCount(tx, countId));
      const n = await tx.$executeRaw`UPDATE stock_count_lines SET counted = ${value}, counted_by = ${actor}, counted_at = now() WHERE count_id = ${countId}::uuid AND item_id = ${itemId}::uuid`;
      if (n === 0) throw new NotFoundError('Count line');
      return (await this.lines(tx, countId)).find((l) => l.itemId === itemId)!;
    }, TX);
  }

  async cancel(countId: string, actor: string | null): Promise<CountView> {
    return this.prisma.$transaction(async (tx) => {
      this.assertOpen(await this.lockCount(tx, countId));
      await tx.$executeRaw`UPDATE stock_counts SET status = 'cancelled', closed_at = now(), closed_by = ${actor} WHERE id = ${countId}::uuid`;
      return this.view(tx, countId);
    }, TX);
  }

  async close(countId: string, actor: string | null, correlationId: string, clock: () => Date = () => new Date()): Promise<{ count: CountView; adjustments: { itemName: string; delta: number; onHandAfter: number }[] }> {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lockCount(tx, countId);
      this.assertOpen(c);
      const rows = await tx.$queryRaw<{ item_id: string; item_name: string; expected: number; counted: number | null }[]>`SELECT item_id, item_name, expected, counted FROM stock_count_lines WHERE count_id = ${countId}::uuid`;
      const lines: CountLine[] = rows.map((r) => ({ itemId: r.item_id, itemName: r.item_name, expected: r.expected, counted: r.counted }));
      const ids = lines.filter((l) => l.counted !== null).map((l) => l.itemId).sort();
      // Artículos en orden de id y leídos dentro del bloqueo.
      const cur = ids.length ? await tx.$queryRaw<{ id: string; on_hand: number }[]>`SELECT id, on_hand FROM items WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE` : [];
      const plan = planClose(lines, new Map(cur.map((r) => [r.id, r.on_hand])));
      const now = clock();
      const reason = `Conteo físico #${c.number}`;
      for (const p of plan) {
        await tx.$executeRaw`UPDATE items SET on_hand = ${p.onHandAfter} WHERE id = ${p.itemId}::uuid`;
        await tx.stockMovement.create({ data: { itemId: p.itemId, itemName: p.itemName, delta: p.delta, onHandAfter: p.onHandAfter, source: 'count', reason, actor } });
        const ev = stockChanged({ id: p.itemId, name: p.itemName }, p.delta, p.onHandAfter, 'adjustment', reason, correlationId, now);
        await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: `${countId}:${p.itemId}`, type: ev.type, routingKey: routingKeyOf(ev), payload: ev as unknown as Prisma.InputJsonValue } });
        await tx.$executeRaw`UPDATE stock_count_lines SET applied_delta = ${p.delta} WHERE count_id = ${countId}::uuid AND item_id = ${p.itemId}::uuid`;
      }
      await tx.$executeRaw`UPDATE stock_counts SET status = 'closed', closed_at = now(), closed_by = ${actor} WHERE id = ${countId}::uuid`;
      return { count: await this.view(tx, countId), adjustments: plan.map((p) => ({ itemName: p.itemName, delta: p.delta, onHandAfter: p.onHandAfter })) };
    }, TX);
  }

  async list(limit = 20): Promise<CountView[]> {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM stock_counts ORDER BY number DESC LIMIT ${limit}`;
    return this.prisma.$transaction(async (tx) => { const out: CountView[] = []; for (const r of ids) out.push(await this.view(tx, r.id)); return out; });
  }
  async get(id: string): Promise<{ count: CountView; lines: CountLineView[] }> {
    return this.prisma.$transaction(async (tx) => {
      if ((await tx.$queryRaw<unknown[]>`SELECT 1 FROM stock_counts WHERE id = ${id}::uuid`).length === 0) throw new NotFoundError('Count');
      return { count: await this.view(tx, id), lines: await this.lines(tx, id) };
    });
  }

  private async lines(tx: Tx, id: string): Promise<CountLineView[]> {
    const rows = await tx.$queryRaw<{ item_id: string; item_name: string; expected: number; counted: number | null; applied_delta: number | null }[]>`SELECT item_id, item_name, expected, counted, applied_delta FROM stock_count_lines WHERE count_id = ${id}::uuid ORDER BY item_name, item_id`;
    return rows.map((r) => ({ itemId: r.item_id, itemName: r.item_name, expected: r.expected, counted: r.counted, variance: r.counted === null ? null : r.counted - r.expected, appliedDelta: r.applied_delta }));
  }
  private async view(tx: Tx, id: string): Promise<CountView> {
    const r = (await tx.$queryRaw<any[]>`
      SELECT c.id, c.number, c.status, c.opened_by, c.opened_at, c.closed_by, c.closed_at,
             (SELECT count(*) FROM stock_count_lines l WHERE l.count_id = c.id)::int AS lines,
             (SELECT count(*) FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted IS NOT NULL)::int AS counted,
             (SELECT count(*) FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted IS NOT NULL AND l.counted <> l.expected)::int AS differences
      FROM stock_counts c WHERE c.id = ${id}::uuid`)[0];
    return { id: r.id, number: r.number, status: r.status, openedBy: r.opened_by, openedAt: new Date(r.opened_at).toISOString(), closedBy: r.closed_by, closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null, lines: r.lines, counted: r.counted, differences: r.differences };
  }
}
