import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { newAllocation } from '../domain/allocation';
import { dateDay, dayDate } from './prisma-unit-of-work';
import { EngineerNotFoundError, OverAllocationError } from '../domain/errors';
import { overAllocationDetected } from '../domain/events';
import { peakLoad } from '../domain/load';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface MaintenanceInput { engineerId: string; label: unknown; percent: unknown; startDate: unknown; endDate: unknown; allowOverallocation?: boolean }

/**
 * Las órdenes de trabajo gastan capacidad. UNA asignación de mantenimiento por orden (work_order_id único), idempotente: repetir la misma reserva no duplica,
 * y cambiar de persona la MUEVE. Se bloquean las filas de los ingenieros (el nuevo y el anterior) SIEMPRE por id ascendente, y se relee la asignación de la orden
 * DENTRO del bloqueo: dos órdenes a la vez sobre la misma persona no pasan de 100 %, y mover una orden mientras otra se reserva no forma un ciclo de bloqueos.
 */
export class MaintenanceService {
  constructor(private readonly prisma: PrismaClient, private readonly clock: () => Date = () => new Date()) {}

  async reserve(orderId: string, input: MaintenanceInput, correlationId: string): Promise<{ allocationId: string; peak: number; overAllocated: boolean }> {
    if (!UUID.test(orderId)) throw new EngineerNotFoundError();
    const a = newAllocation(input.engineerId, input.label, input.percent, input.startDate, input.endDate);
    for (let attempt = 0; attempt < 4; attempt++) {
      const previous = (await this.prisma.$queryRaw<{ engineer_id: string }[]>`SELECT engineer_id FROM allocations WHERE work_order_id = ${orderId}::uuid`)[0]?.engineer_id ?? null;
      let result: Awaited<ReturnType<MaintenanceService['reserve']>> | 'retry';
      try {
      result = await this.prisma.$transaction(async (tx) => {
        const ids = [...new Set([input.engineerId, ...(previous ? [previous] : [])])].sort();
        let target: { id: string; name: string; dailyCostCop: number | null } | undefined;
        for (const id of ids) {
          const rows = await tx.$queryRaw<{ id: string; name: string; daily: number | null }[]>`SELECT id, name, daily_cost_cop AS daily FROM engineers WHERE id = ${id}::uuid FOR UPDATE`;
          if (rows.length === 0 && id === input.engineerId) throw new EngineerNotFoundError();
          if (id === input.engineerId) target = { id, name: rows[0].name, dailyCostCop: rows[0].daily };
        }
        // Releer DENTRO del bloqueo: si otro movió la orden mientras esperábamos, se reintenta con los bloqueos correctos.
        const own = (await tx.$queryRaw<{ id: string; engineer_id: string }[]>`SELECT id, engineer_id FROM allocations WHERE work_order_id = ${orderId}::uuid`)[0] ?? null;
        if ((own?.engineer_id ?? null) !== previous) return 'retry' as const;
        const others = (await tx.$queryRaw<{ id: string; percent: number; start_date: Date; end_date: Date }[]>`
          SELECT id, percent, start_date, end_date FROM allocations
          WHERE engineer_id = ${input.engineerId}::uuid AND start_date <= ${dayDate(a.end)}::date AND end_date >= ${dayDate(a.start)}::date AND (work_order_id IS DISTINCT FROM ${orderId}::uuid)`)
          .map((r) => ({ percent: r.percent, start: dateDay(r.start_date), end: dateDay(r.end_date) }));
        const { peak } = peakLoad([...others, { percent: a.percent, start: a.start, end: a.end }], a.start, a.end);
        const over = peak > 100;
        if (over && !input.allowOverallocation) throw new OverAllocationError(peak, target!.name);
        let allocationId: string;
        if (own) {
          allocationId = own.id;
          await tx.$executeRaw`UPDATE allocations SET engineer_id = ${input.engineerId}::uuid, project_name = ${a.projectName}, percent = ${a.percent}, start_date = ${dayDate(a.start)}::date, end_date = ${dayDate(a.end)}::date, over_allocated = ${over} WHERE id = ${own.id}::uuid`;
        } else {
          allocationId = randomUUID();
          await tx.$executeRaw`INSERT INTO allocations (id, engineer_id, project_name, percent, start_date, end_date, over_allocated, kind, work_order_id)
            VALUES (${allocationId}::uuid, ${input.engineerId}::uuid, ${a.projectName}, ${a.percent}, ${dayDate(a.start)}::date, ${dayDate(a.end)}::date, ${over}, 'maintenance', ${orderId}::uuid)`;
        }
        if (over) {
          const ev = overAllocationDetected({ id: target!.id, name: target!.name } as never, { ...a, id: allocationId }, peak, correlationId, this.clock());
          await tx.outboxEvent.createMany({ data: [{ id: ev.eventId, aggregateId: allocationId, type: ev.type, routingKey: 'capacity.overallocation.detected', payload: ev as unknown as Prisma.InputJsonValue }], skipDuplicates: true });
        }
        return { allocationId, peak, overAllocated: over };
      }, { timeout: 10_000, maxWait: 10_000 });
      } catch (e) {
        // Dos reservas de la MISMA orden que empiezan a la vez (aún sin asignación) intentan insertar las dos: gana una y la otra reintenta como «mover».
        if (/allocations_work_order_key|duplicate key|unique constraint/i.test(String((e as Error)?.message)) || (e as { code?: string })?.code === 'P2010') continue;
        throw e;
      }
      if (result !== 'retry') return result;
    }
    throw new Error('the work order is being moved by someone else; try again');
  }

  /** Libera la asignación de la orden. Idempotente: si no existe, no pasa nada (el evento de cierre puede repetirse). Devuelve cuántas borró. */
  async release(orderId: string): Promise<number> {
    if (!UUID.test(orderId)) return 0;
    return this.prisma.$executeRaw`DELETE FROM allocations WHERE work_order_id = ${orderId}::uuid`;
  }
}
