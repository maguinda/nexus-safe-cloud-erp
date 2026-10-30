import { ConflictError, ValidationError } from './errors';

export const MAX_COUNTED = 1_000_000;

export function validateCounted(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_COUNTED) throw new ValidationError(`counted must be a whole number from 0 to ${MAX_COUNTED}`);
  return v;
}

export interface CountLine { itemId: string; itemName: string; expected: number; counted: number | null }
export interface PlannedAdjustment { itemId: string; itemName: string; delta: number; onHandAfter: number }

/**
 * Qué ajustes salen de cerrar un conteo. La diferencia es contado − esperado (la foto del día que se abrió): lo que entró o salió DESPUÉS de abrir
 * (pedidos recibidos, ajustes) se conserva, no se borra. Las líneas sin contar no se tocan y las que no difieren no dejan movimiento.
 * `current` es el stock leído DENTRO del bloqueo. Si algún artículo quedaría negativo, el cierre completo se rechaza (nada se aplica a medias).
 */
export function planClose(lines: CountLine[], current: Map<string, number>): PlannedAdjustment[] {
  const out: PlannedAdjustment[] = [];
  for (const l of [...lines].sort((a, b) => (a.itemId < b.itemId ? -1 : 1))) {
    if (l.counted === null) continue;
    const delta = l.counted - l.expected;
    if (delta === 0) continue;
    const now = current.get(l.itemId);
    if (now === undefined) throw new ConflictError(`${l.itemName} no longer exists`);
    const after = now + delta;
    if (after < 0) throw new ConflictError(`${l.itemName} has ${now} in stock now: the count would leave it at ${after}. Review the count`);
    out.push({ itemId: l.itemId, itemName: l.itemName, delta, onHandAfter: after });
  }
  return out;
}
