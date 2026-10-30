import { Prisma, PrismaClient } from '@prisma/client';

import { WORK_ORDER_CLOSED_ROUTING_KEY, WORK_ORDER_CREATED_ROUTING_KEY, workOrderClosed, workOrderCreated } from '../domain/events';
import { canTransition, isClosing, NewWorkOrder, orderLabel, validateAssignee, validateStatusChange, WorkOrderStateError, WoStatus } from '../domain/work-order';

const TX = { timeout: 15_000, maxWait: 15_000 };
type Tx = Prisma.TransactionClient;
export class WorkOrderNotFoundError extends Error {}
export class WorkOrderTargetMissingError extends Error {}
export class WorkOrderDuplicateError extends Error { constructor(public readonly existing: string) { super(`There is already an open work order ${existing} for that equipment and type`); } }

export interface WorkOrderView {
  id: string; number: string; type: string; status: string; priority: string; targetKind: string; targetRef: string; targetName: string; description: string; sourceNote: string | null;
  dueDate: string | null; assignedTo: string | null; createdBy: string | null; createdAt: string; closedBy: string | null; closedAt: string | null;
}
const view = (r: any): WorkOrderView => ({ id: r.id, number: orderLabel(r.number), type: r.type, status: r.status, priority: r.priority, targetKind: r.targetKind ?? r.target_kind, targetRef: r.targetRef ?? r.target_ref, targetName: r.targetName ?? r.target_name,
  description: r.description, sourceNote: r.sourceNote ?? r.source_note ?? null, dueDate: (r.dueDate ?? r.due_date) ? new Date(r.dueDate ?? r.due_date).toISOString().slice(0, 10) : null, assignedTo: r.assignedTo ?? r.assigned_to ?? null,
  createdBy: r.createdBy ?? r.created_by ?? null, createdAt: new Date(r.createdAt ?? r.created_at).toISOString(), closedBy: r.closedBy ?? r.closed_by ?? null, closedAt: (r.closedAt ?? r.closed_at) ? new Date(r.closedAt ?? r.closed_at).toISOString() : null });

/**
 * Órdenes de trabajo. El equipo se busca en la base (el nombre NO viene del cliente). Crear y cerrar publican su evento en la MISMA transacción (outbox).
 * Cambiar de estado bloquea la fila de la orden y relee el estado dentro del bloqueo: dos cambios a la vez (cerrar y cancelar) no se pisan.
 */
export class WorkOrdersService {
  constructor(private readonly prisma: PrismaClient, private readonly clock: () => Date = () => new Date()) {}

  async create(input: NewWorkOrder, actor: string | null, correlationId: string): Promise<WorkOrderView> {
    return this.prisma.$transaction(async (tx) => {
      const name = input.targetKind === 'sensor'
        ? (await tx.$queryRaw<{ name: string }[]>`SELECT name FROM iot_devices WHERE id = ${input.targetRef}`)[0]?.name
        : (await tx.$queryRaw<{ name: string }[]>`SELECT name FROM network_devices WHERE id = ${Number(input.targetRef)}`)[0]?.name;
      if (!name) throw new WorkOrderTargetMissingError('That equipment does not exist');
      let row: any;
      try {
        row = (await tx.$queryRaw<any[]>`
          INSERT INTO work_orders (type, priority, target_kind, target_ref, target_name, description, source_note, due_date, assigned_to, created_by)
          VALUES (${input.type}, ${input.priority}, ${input.targetKind}, ${input.targetRef}, ${name}, ${input.description}, ${input.sourceNote}, ${input.dueDate}::date, ${input.assignedTo}, ${actor}) RETURNING *`)[0];
      } catch (e: any) {
        if (/work_orders_one_open_key|duplicate key|unique/i.test(String(e?.message)) || e?.code === 'P2010' || e?.code === 'P2002') {
          // La transacción abortó: el número de la orden abierta se busca con otra consulta (fuera de ella).
          throw new WorkOrderDuplicateError('another');
        }
        throw e;
      }
      await tx.$executeRaw`INSERT INTO work_order_log (order_id, from_status, to_status, actor, note) VALUES (${row.id}::uuid, NULL, 'open', ${actor}, NULL)`;
      const ev = workOrderCreated({ orderNumber: orderLabel(row.number), orderType: input.type, priority: input.priority, targetKind: input.targetKind, targetName: name, dueDate: input.dueDate }, correlationId, this.clock());
      await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: row.id, type: ev.type, routingKey: WORK_ORDER_CREATED_ROUTING_KEY, payload: ev as unknown as Prisma.InputJsonValue } });
      return view(row);
    }, TX).catch(async (e) => {
      if (e instanceof WorkOrderDuplicateError) {
        const ex = (await this.prisma.$queryRaw<{ number: number }[]>`SELECT number FROM work_orders WHERE target_kind = ${input.targetKind} AND target_ref = ${input.targetRef} AND type = ${input.type} AND status IN ('open', 'in_progress') LIMIT 1`)[0];
        throw new WorkOrderDuplicateError(ex ? orderLabel(ex.number) : 'one');
      }
      throw e;
    });
  }

  async changeStatus(id: string, rawStatus: unknown, rawNote: unknown, actor: string | null, correlationId: string): Promise<WorkOrderView> {
    const { status, note } = validateStatusChange(rawStatus, rawNote);
    return this.prisma.$transaction(async (tx) => {
      const cur = (await tx.$queryRaw<any[]>`SELECT * FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`)[0];
      if (!cur) throw new WorkOrderNotFoundError('Work order not found');
      if (!canTransition(cur.status as WoStatus, status)) throw new WorkOrderStateError(`The work order is ${cur.status}: it cannot go to ${status}`);
      const closing = isClosing(status);
      const row = (await tx.$queryRaw<any[]>`
        UPDATE work_orders SET status = ${status}, closed_at = ${closing ? this.clock() : null}, closed_by = ${closing ? actor : null} WHERE id = ${id}::uuid RETURNING *`)[0];
      await tx.$executeRaw`INSERT INTO work_order_log (order_id, from_status, to_status, actor, note) VALUES (${id}::uuid, ${cur.status}, ${status}, ${actor}, ${note})`;
      if (closing) {
        const ev = workOrderClosed({ orderNumber: orderLabel(cur.number), orderType: cur.type, outcome: status as 'done' | 'cancelled', targetName: cur.target_name }, correlationId, this.clock());
        await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: id, type: ev.type, routingKey: WORK_ORDER_CLOSED_ROUTING_KEY, payload: ev as unknown as Prisma.InputJsonValue } });
      }
      return view(row);
    }, TX);
  }

  async assign(id: string, raw: unknown, actor: string | null): Promise<WorkOrderView> {
    const who = validateAssignee(raw);
    return this.prisma.$transaction(async (tx) => {
      const cur = (await tx.$queryRaw<any[]>`SELECT status FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`)[0];
      if (!cur) throw new WorkOrderNotFoundError('Work order not found');
      if (cur.status === 'done' || cur.status === 'cancelled') throw new WorkOrderStateError(`The work order is ${cur.status}: it cannot be reassigned`);
      const row = (await tx.$queryRaw<any[]>`UPDATE work_orders SET assigned_to = ${who} WHERE id = ${id}::uuid RETURNING *`)[0];
      await tx.$executeRaw`INSERT INTO work_order_log (order_id, from_status, to_status, actor, note) VALUES (${id}::uuid, ${cur.status}, ${cur.status}, ${actor}, ${who ? `Asignada a ${who}` : 'Sin responsable'})`;
      return view(row);
    }, TX);
  }

  async list(opts: { status?: string; limit: number }): Promise<WorkOrderView[]> {
    const rows = opts.status
      ? await this.prisma.$queryRaw<any[]>`SELECT * FROM work_orders WHERE status = ${opts.status} ORDER BY created_at DESC, number DESC LIMIT ${opts.limit}`
      : await this.prisma.$queryRaw<any[]>`SELECT * FROM work_orders ORDER BY (status IN ('open','in_progress')) DESC, created_at DESC, number DESC LIMIT ${opts.limit}`;
    return rows.map(view);
  }

  async get(id: string): Promise<{ order: WorkOrderView; log: { from: string | null; to: string; actor: string | null; note: string | null; at: string }[] }> {
    const r = (await this.prisma.$queryRaw<any[]>`SELECT * FROM work_orders WHERE id = ${id}::uuid`)[0];
    if (!r) throw new WorkOrderNotFoundError('Work order not found');
    const log = await this.prisma.$queryRaw<any[]>`SELECT from_status, to_status, actor, note, at FROM work_order_log WHERE order_id = ${id}::uuid ORDER BY at, id`;
    return { order: view(r), log: log.map((l) => ({ from: l.from_status, to: l.to_status, actor: l.actor, note: l.note, at: new Date(l.at).toISOString() })) };
  }
}
