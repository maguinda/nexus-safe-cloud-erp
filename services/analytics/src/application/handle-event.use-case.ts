import { describe, mergeEvent } from '../domain/fact';
import { parseEvent } from '../domain/events';
import { EventUnitOfWork } from '../domain/ports';

export type HandleResult = 'applied' | 'duplicate';

/**
 * Idempotente: RabbitMQ entrega «al menos una vez». En una transacción se anota el eventId, se fusiona en el hecho del hito
 * y se anota la actividad; si algo falla no queda nada y el reintento lo procesa completo.
 */
export class HandleEventUseCase {
  constructor(private readonly uow: EventUnitOfWork) {}

  async execute(raw: unknown): Promise<HandleResult> {
    const event = parseEvent(raw); // lanza InvalidEventError si el mensaje no cumple el contrato
    return this.uow.run(async (tx) => {
      if (!(await tx.markEventProcessed(event.eventId))) return 'duplicate';
      await tx.mergeFact(event, (prev) => mergeEvent(prev, event));
      await tx.addActivity(event.eventId, event.type, describe(event), new Date(event.occurredAt));
      return 'applied';
    });
  }
}
