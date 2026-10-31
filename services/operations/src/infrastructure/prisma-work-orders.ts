import { Prisma, PrismaClient } from '@prisma/client';

import { WORK_ORDER_CLOSED_ROUTING_KEY, WORK_ORDER_CREATED_ROUTING_KEY, workOrderClosed, workOrderCreated } from '../domain/events';
import { canTransition, CapacityRequest, isClosing, NewWorkOrder, orderLabel, validateAssignee, validateAssigneeId, validateCapacity, validateStatusChange, WorkOrderStateError, WoStatus } from '../domain/work-order';
import { CapacityClient, CapacityUnavailableError } from './capacity-client';

const TX = { timeout: 15_000, maxWait: 15_000 };
type Tx = Prisma.TransactionClient;
export class WorkOrderNotFoundError extends Error {}
export class WorkOrderTargetMissingError extends Error {}
export class WorkOrderDuplicateError extends Error { constructor(public readonly existing: string) { super(`There is already an open work order ${existing} for that equipment and type`); } }

export interface WorkOrderView {
  id: string; number: string; type: string; status: string; priority: string; targetKind: string; targetRef: string; targetName: string; description: string; sourceNote: string | null;
  dueDate: string | null; assignedTo: string | null; assignedToId: string | null; capacityPercent: number | null; capacityStart: string | null; capacityEnd: string | null; capacityState: string; createdBy: string | null; createdAt: string; closedBy: string | null; closedAt: string | null;
}
const view = (r: any): WorkOrderView => ({ id: r.id, number: orderLabel(r.number), type: r.type, status: r.status, priority: r.priority, targetKind: r.targetKind ?? r.target_kind, targetRef: r.targetRef ?? r.target_ref, targetName: r.targetName ?? r.target_name,
  description: r.description, sourceNote: r.sourceNote ?? r.source_note ?? null, dueDate: (r.dueDate ?? r.due_date) ? new Date(r.dueDate ?? r.due_date).toISOString().slice(0, 10) : null, assignedTo: r.assignedTo ?? r.assigned_to ?? null, assignedToId: r.assignedToId ?? r.assigned_to_id ?? null,
  capacityPercent: r.capacity_percent ?? null, capacityStart: r.capacity_start ? new Date(r.capacity_start).toISOString().slice(0, 10) : null, capacityEnd: r.capacity_end ? new Date(r.capacity_end).toISOString().slice(0, 10) : null, capacityState: r.capacity_state ?? 'none',
  createdBy: r.createdBy ?? r.created_by ?? null, createdAt: new Date(r.createdAt ?? r.created_at).toISOString(), closedBy: r.closedBy ?? r.closed_by ?? null, closedAt: (r.closedAt ?? r.closed_at) ? new Date(r.closedAt ?? r.closed_at).toISOString() : null });

/**
 * Órdenes de trabajo. El equipo se busca en la base (el nombre NO viene del cliente). Crear y cerrar publican su evento en la MISMA transacción (outbox).
 * Cambiar de estado bloquea la fila de la orden y relee el estado dentro del bloqueo: dos cambios a la vez (cerrar y cancelar) no se pisan.
 */
export class WorkOrdersService {
  constructor(private readonly prisma: PrismaClient, private readonly capacity: CapacityClient, private readonly clock: () => Date = () => new Date()) {}

  private label(number: number, targetName: string) { return `${orderLabel(number)} · ${targetName}`.slice(0, 80); }
  private reserveInput(engineerId: string, label: string, c: CapacityRequest) { return { engineerId, label, percent: c.percent, startDate: c.startDate, endDate: c.endDate, allowOverallocation: c.allowOverallocation }; }

  /**
   * Crear. Con responsable de la lista la orden GASTA capacidad: se guarda «pendiente», se reserva en Capacidad (regla del 100 %) y solo si la aceptó queda «reservada»
   * y se publica WorkOrderCreated. Si Capacidad la rechaza (o no contesta) la orden se borra: no queda ni la orden ni el cupo, ni un aviso falso.
   */
  async create(input: NewWorkOrder, actor: string | null, correlationId: string, bearer = ''): Promise<WorkOrderView> {
    const cap = input.assignedToId !== null ? input.capacity : null;
    const row = await this.prisma.$transaction(async (tx) => {
      const name = input.targetKind === 'sensor'
        ? (await tx.$queryRaw<{ name: string }[]>`SELECT name FROM iot_devices WHERE id = ${input.targetRef}`)[0]?.name
        : (await tx.$queryRaw<{ name: string }[]>`SELECT name FROM network_devices WHERE id = ${Number(input.targetRef)}`)[0]?.name;
      if (!name) throw new WorkOrderTargetMissingError('That equipment does not exist');
      let r: any;
      try {
        r = (await tx.$queryRaw<any[]>`
          INSERT INTO work_orders (type, priority, target_kind, target_ref, target_name, description, source_note, due_date, assigned_to, assigned_to_id, capacity_percent, capacity_start, capacity_end, capacity_state, created_by)
          VALUES (${input.type}, ${input.priority}, ${input.targetKind}, ${input.targetRef}, ${name}, ${input.description}, ${input.sourceNote}, ${input.dueDate}::date, ${input.assignedTo}, ${input.assignedToId}::uuid,
            ${cap?.percent ?? null}, ${cap?.startDate ?? null}::date, ${cap?.endDate ?? null}::date, ${cap ? 'pending' : 'none'}, ${actor}) RETURNING *`)[0];
      } catch (e: any) {
        if (/work_orders_one_open_key|duplicate key|unique/i.test(String(e?.message)) || e?.code === 'P2010' || e?.code === 'P2002') {
          // La transacción abortó: el número de la orden abierta se busca con otra consulta (fuera de ella).
          throw new WorkOrderDuplicateError('another');
        }
        throw e;
      }
      await tx.$executeRaw`INSERT INTO work_order_log (order_id, from_status, to_status, actor, note) VALUES (${r.id}::uuid, NULL, 'open', ${actor}, NULL)`;
      if (!cap) await this.publishCreated(tx, r, input.type, input.priority, input.targetKind, name, input.dueDate, correlationId);
      return r;
    }, TX).catch(async (e) => {
      if (e instanceof WorkOrderDuplicateError) {
        const ex = (await this.prisma.$queryRaw<{ number: number }[]>`SELECT number FROM work_orders WHERE target_kind = ${input.targetKind} AND target_ref = ${input.targetRef} AND type = ${input.type} AND status IN ('open', 'in_progress') LIMIT 1`)[0];
        throw new WorkOrderDuplicateError(ex ? orderLabel(ex.number) : 'one');
      }
      throw e;
    });
    if (!cap) return view(row);

    try {
      await this.capacity.reserve(row.id, this.reserveInput(input.assignedToId!, this.label(row.number, row.target_name), cap), bearer, correlationId);
    } catch (e) {
      // Sin saber si Capacidad guardó o no (no contestó), se libera por si acaso; luego la orden desaparece: nada queda a medias.
      if (e instanceof CapacityUnavailableError) await this.capacity.release(row.id, bearer, correlationId).catch(() => undefined);
      await this.prisma.$executeRaw`DELETE FROM work_orders WHERE id = ${row.id}::uuid AND capacity_state = 'pending'`;
      throw e;
    }
    return this.prisma.$transaction(async (tx) => {
      const r = (await tx.$queryRaw<any[]>`UPDATE work_orders SET capacity_state = 'reserved' WHERE id = ${row.id}::uuid RETURNING *`)[0];
      await this.publishCreated(tx, r, input.type, input.priority, input.targetKind, row.target_name, input.dueDate, correlationId);
      return view(r);
    }, TX);
  }

  private async publishCreated(tx: Tx, r: any, type: string, priority: string, targetKind: string, targetName: string, dueDate: string | null, correlationId: string) {
    const ev = workOrderCreated({ orderNumber: orderLabel(r.number), orderType: type, priority, targetKind, targetName, dueDate }, correlationId, this.clock());
    await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: r.id, type: ev.type, routingKey: WORK_ORDER_CREATED_ROUTING_KEY, payload: ev as unknown as Prisma.InputJsonValue } });
  }

  /** Las órdenes de UNA persona del personal (ingeniero o técnico): las abiertas primero, las más recientes arriba. */
  async mine(staffId: string, limit = 100): Promise<WorkOrderView[]> {
    const rows = await this.prisma.$queryRaw<any[]>`SELECT * FROM work_orders WHERE assigned_to_id = ${staffId}::uuid ORDER BY (status IN ('open','in_progress')) DESC, created_at DESC, number DESC LIMIT ${limit}`;
    return rows.map(view);
  }

  /**
   * Cambiar el estado. `ownerId` (el ingeniero o técnico que lo pide) hace que SOLO pueda tocar una orden que es suya: una ajena responde «no existe» (404), igual que un id inventado,
   * y la comprobación se hace con la fila ya bloqueada, así que reasignar a la vez no deja pasar a quien ya no es el responsable.
   */
  async changeStatus(id: string, rawStatus: unknown, rawNote: unknown, actor: string | null, correlationId: string, ownerId?: string): Promise<WorkOrderView> {
    const { status, note } = validateStatusChange(rawStatus, rawNote);
    return this.prisma.$transaction(async (tx) => {
      const cur = (await tx.$queryRaw<any[]>`SELECT * FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`)[0];
      if (!cur || (ownerId !== undefined && cur.assigned_to_id !== ownerId)) throw new WorkOrderNotFoundError('Work order not found');
      if (cur.capacity_state === 'pending') throw new WorkOrderStateError('The capacity of this work order is being confirmed: try again in a moment');
      if (!canTransition(cur.status as WoStatus, status)) throw new WorkOrderStateError(`The work order is ${cur.status}: it cannot go to ${status}`);
      const closing = isClosing(status);
      const row = (await tx.$queryRaw<any[]>`
        UPDATE work_orders SET status = ${status}, closed_at = ${closing ? this.clock() : null}, closed_by = ${closing ? actor : null} WHERE id = ${id}::uuid RETURNING *`)[0];
      await tx.$executeRaw`INSERT INTO work_order_log (order_id, from_status, to_status, actor, note) VALUES (${id}::uuid, ${cur.status}, ${status}, ${actor}, ${note})`;
      if (closing) {
        // Capacidad libera la reserva al recibir este aviso (outbox en la MISMA transacción): cerrar y liberar no se pueden separar.
        const ev = workOrderClosed({ orderId: id, orderNumber: orderLabel(cur.number), orderType: cur.type, outcome: status as 'done' | 'cancelled', targetName: cur.target_name }, correlationId, this.clock());
        await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: id, type: ev.type, routingKey: WORK_ORDER_CLOSED_ROUTING_KEY, payload: ev as unknown as Prisma.InputJsonValue } });
      }
      return view(row);
    }, TX);
  }

  /**
   * Asignar, reasignar o quitar al responsable. Con una persona de la lista, la reserva se MUEVE en Capacidad (porcentaje y fechas obligatorios, regla del 100 %); si Capacidad
   * la rechaza, la orden queda exactamente como estaba. Mientras se confirma, la orden está «pendiente» y nadie más la puede cambiar ni cerrar.
   */
  async assign(id: string, dto: Record<string, unknown>, actor: string | null, correlationId = 'no-correlation', bearer = ''): Promise<WorkOrderView> {
    const who = validateAssignee(dto.assignedTo);
    const whoId = validateAssigneeId(dto.assignedToId, who);
    const cap = validateCapacity(dto, whoId);
    const prev = await this.prisma.$transaction(async (tx) => {
      const cur = (await tx.$queryRaw<any[]>`SELECT * FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`)[0];
      if (!cur) throw new WorkOrderNotFoundError('Work order not found');
      if (cur.status === 'done' || cur.status === 'cancelled') throw new WorkOrderStateError(`The work order is ${cur.status}: it cannot be reassigned`);
      if (cur.capacity_state === 'pending') throw new WorkOrderStateError('The capacity of this work order is being confirmed: try again in a moment');
      if (whoId && cap) {
        await tx.$executeRaw`UPDATE work_orders SET assigned_to = ${who}, assigned_to_id = ${whoId}::uuid, capacity_percent = ${cap.percent}, capacity_start = ${cap.startDate}::date, capacity_end = ${cap.endDate}::date, capacity_state = 'pending' WHERE id = ${id}::uuid`;
      } else if (cur.capacity_state === 'reserved') {
        await tx.$executeRaw`UPDATE work_orders SET capacity_state = 'pending' WHERE id = ${id}::uuid`; // hay que liberar en Capacidad antes de borrar los datos
      } else {
        const r = (await tx.$queryRaw<any[]>`UPDATE work_orders SET assigned_to = ${who}, assigned_to_id = NULL, capacity_state = 'none' WHERE id = ${id}::uuid RETURNING *`)[0];
        await tx.$executeRaw`INSERT INTO work_order_log (order_id, from_status, to_status, actor, note) VALUES (${id}::uuid, ${cur.status}, ${cur.status}, ${actor}, ${who ? `Asignada a ${who}` : 'Sin responsable'})`;
        return { done: view(r), cur: null as any };
      }
      return { done: null as WorkOrderView | null, cur };
    }, TX);
    if (prev.done) return prev.done;
    const cur = prev.cur;
    const restore = async () => {
      await this.prisma.$executeRaw`UPDATE work_orders SET assigned_to = ${cur.assigned_to}, assigned_to_id = ${cur.assigned_to_id}::uuid, capacity_percent = ${cur.capacity_percent}, capacity_start = ${cur.capacity_start}::date, capacity_end = ${cur.capacity_end}::date, capacity_state = ${cur.capacity_state} WHERE id = ${id}::uuid`;
    };

    if (whoId && cap) {
      try {
        await this.capacity.reserve(id, this.reserveInput(whoId, this.label(cur.number, cur.target_name), cap), bearer, correlationId);
      } catch (e) {
        // Todo como estaba: la fila vuelve a sus valores y, si Capacidad no contestó, se le devuelve también la reserva anterior (o se libera si no había).
        await restore();
        if (e instanceof CapacityUnavailableError) {
          if (cur.capacity_state === 'reserved') await this.capacity.reserve(id, this.reserveInput(cur.assigned_to_id, this.label(cur.number, cur.target_name), { percent: cur.capacity_percent, startDate: cur.capacity_start.toISOString().slice(0, 10), endDate: cur.capacity_end.toISOString().slice(0, 10), allowOverallocation: true }), bearer, correlationId).catch(() => undefined);
          else await this.capacity.release(id, bearer, correlationId).catch(() => undefined);
        }
        throw e;
      }
      return this.prisma.$transaction(async (tx) => {
        const r = (await tx.$queryRaw<any[]>`UPDATE work_orders SET capacity_state = 'reserved' WHERE id = ${id}::uuid RETURNING *`)[0];
        await tx.$executeRaw`INSERT INTO work_order_log (order_id, from_status, to_status, actor, note) VALUES (${id}::uuid, ${cur.status}, ${cur.status}, ${actor}, ${`Asignada a ${who} (${cap.percent} % del ${cap.startDate} al ${cap.endDate})`})`;
        return view(r);
      }, TX);
    }

    // Quitar al responsable (o poner un nombre sin id) con una reserva vigente: primero se libera en Capacidad.
    try { await this.capacity.release(id, bearer, correlationId); } catch (e) { await restore(); throw e; }
    return this.prisma.$transaction(async (tx) => {
      const r = (await tx.$queryRaw<any[]>`UPDATE work_orders SET assigned_to = ${who}, assigned_to_id = NULL, capacity_percent = NULL, capacity_start = NULL, capacity_end = NULL, capacity_state = 'none' WHERE id = ${id}::uuid RETURNING *`)[0];
      await tx.$executeRaw`INSERT INTO work_order_log (order_id, from_status, to_status, actor, note) VALUES (${id}::uuid, ${cur.status}, ${cur.status}, ${actor}, ${who ? `Asignada a ${who}` : 'Sin responsable'})`;
      return view(r);
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
