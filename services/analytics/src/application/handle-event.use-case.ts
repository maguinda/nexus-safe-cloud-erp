import { describe, mergeEvent } from '../domain/fact';
import { parseEvent } from '../domain/events';
import { EventUnitOfWork } from '../domain/ports';

export type HandleResult = 'applied' | 'duplicate';
const ALLOCATION_TYPES = new Set(['EngineerAllocated', 'AllocationRemoved']);

/**
 * Idempotente: RabbitMQ entrega «al menos una vez». En una transacción se anota el eventId, se fusiona en el hecho del hito
 * y se anota la actividad; si algo falla no queda nada y el reintento lo procesa completo.
 */
export class HandleEventUseCase {
  constructor(private readonly uow: EventUnitOfWork, private readonly allocations?: (raw: unknown) => Promise<HandleResult>) {}

  async execute(raw: unknown): Promise<HandleResult> {
    // Los avisos de Technical Capacity no son del hito: van a su propio almacén (rentabilidad).
    if (this.allocations && typeof raw === 'object' && raw !== null && ALLOCATION_TYPES.has((raw as { type?: string }).type ?? '')) return this.allocations(raw);
    const event = parseEvent(raw); // lanza InvalidEventError si el mensaje no cumple el contrato
    return this.uow.run(async (tx) => {
      if (!(await tx.markEventProcessed(event.eventId))) return 'duplicate';
      await tx.mergeFact(event, (prev) => mergeEvent(prev, event));
      await tx.addActivity(event.eventId, event.type, describe(event), new Date(event.occurredAt));
      return 'applied';
    });
  }
}
