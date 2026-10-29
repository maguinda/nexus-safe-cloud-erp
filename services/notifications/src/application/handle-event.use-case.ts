import { parseEvent } from '../domain/events';
import { EventUnitOfWork } from '../domain/ports';

export type HandleResult = 'applied' | 'duplicate';

/**
 * Idempotente: RabbitMQ entrega «al menos una vez». En una transacción se anota el eventId y se guarda el aviso;
 * si algo falla no queda nada y el reintento lo procesa completo, así nunca hay dos avisos por el mismo evento.
 */
export class HandleEventUseCase {
  constructor(private readonly uow: EventUnitOfWork) {}

  async execute(raw: unknown): Promise<HandleResult> {
    const draft = parseEvent(raw); // lanza InvalidEventError si el mensaje no cumple el contrato
    return this.uow.run(async (tx) => {
      if (!(await tx.markEventProcessed(draft.eventId))) return 'duplicate';
      await tx.addNotification(draft);
      return 'applied';
    });
  }
}
