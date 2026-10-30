import { retentionCutoff } from '../domain/retention';
import type { ReadingRetention } from '../domain/ports';

export const RETENTION_BATCH = 5000;
export const MAX_BATCHES_PER_PASS = 20;

/**
 * Borra las lecturas más viejas que el plazo de retención, por tandas (no bloquea la tabla). Nunca borra la ÚLTIMA lectura de un dispositivo
 * (el tablero y el estado de alerta parten de ella) y es seguro repetirlo. Una pasada borra como máximo 20 tandas; si queda más, la siguiente sigue.
 */
export class DeleteOldReadingsUseCase {
  constructor(private readonly store: ReadingRetention, private readonly days: number, private readonly clock: () => Date = () => new Date()) {}

  async execute(): Promise<{ deleted: number }> {
    const cutoff = retentionCutoff(this.clock(), this.days);
    if (!cutoff) return { deleted: 0 };
    let deleted = 0;
    for (let i = 0; i < MAX_BATCHES_PER_PASS; i++) {
      const n = await this.store.deleteOlderThan(cutoff, RETENTION_BATCH);
      deleted += n;
      if (n < RETENTION_BATCH) break;
    }
    return { deleted };
  }
}
