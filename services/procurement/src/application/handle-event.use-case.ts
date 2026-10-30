import { parseThreshold } from '../domain/events';
import { EventUnitOfWork } from '../domain/ports';

export type HandleResult = 'applied' | 'duplicate';

/** Idempotente: se anota el eventId y se guarda la sugerencia en una transacción; un reintento no duplica nada. */
export class HandleEventUseCase {
  constructor(private readonly uow: EventUnitOfWork) {}
  async execute(raw: unknown): Promise<HandleResult> {
    const alert = parseThreshold(raw);
    return this.uow.run(async (tx) => {
      if (!(await tx.markEventProcessed(alert.eventId))) return 'duplicate';
      await tx.addSuggestion(alert);
      return 'applied';
    });
  }
}
