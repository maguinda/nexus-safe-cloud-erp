import { validateBatch, type IngestProblem } from '../domain/ingest';
import type { ReadingIngest } from '../domain/ports';

/** El lote no cumple el contrato: no se guardó nada. */
export class IngestRejectedError extends Error {
  constructor(readonly problems: IngestProblem[]) { super(`Ingest rejected: ${problems.length} problem(s)`); this.name = 'IngestRejectedError'; }
}
export interface IngestResult { accepted: number; duplicates: number }

/**
 * Recibe un lote de lecturas, lo valida completo y lo guarda sin duplicar: reenviar el mismo lote (un reintento, o el simulador
 * reiniciado) no cambia nada. La unicidad (dispositivo, instante) la garantiza la base, así que también aguanta dos envíos a la vez.
 */
export class IngestReadingsUseCase {
  constructor(private readonly store: ReadingIngest, private readonly clock: () => Date = () => new Date()) {}

  async execute(body: unknown): Promise<IngestResult> {
    const { readings, problems } = validateBatch(body, await this.store.deviceUnits(), this.clock());
    if (problems.length > 0) throw new IngestRejectedError(problems);
    const accepted = await this.store.insertReadings(readings);
    return { accepted, duplicates: readings.length - accepted };
  }
}
