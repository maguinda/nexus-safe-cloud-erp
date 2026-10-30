/** Cuánto tiempo se guardan las lecturas de los sensores. 0 = para siempre (la retención apagada). */
export const DEFAULT_RETENTION_DAYS = 365;
export const MIN_RETENTION_DAYS = 30; // más corto que esto borraría datos que los rangos de 6 y 12 meses del tablero necesitan
const DAY_MS = 86_400_000;

/** El instante anterior al cual las lecturas ya se pueden borrar, o null si la retención está apagada. Rechaza valores peligrosos (negativos, fracciones, menos de 30 días). */
export function retentionCutoff(now: Date, days: number): Date | null {
  if (days === 0) return null;
  if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS) throw new Error(`RETENTION_DAYS must be 0 (off) or a whole number of at least ${MIN_RETENTION_DAYS}`);
  return new Date(now.getTime() - days * DAY_MS);
}
