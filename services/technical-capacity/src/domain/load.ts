import { Allocation } from './allocation';

type Slice = Pick<Allocation, 'percent' | 'start' | 'end'>;

export const loadOn = (allocs: Slice[], day: number): number => allocs.reduce((s, a) => (a.start <= day && day <= a.end ? s + a.percent : s), 0);

/** La carga (suma de porcentajes) más alta de cualquier día entre `from` y `to` (incluidos), y el primer día en que ocurre. La carga solo cambia en los días en que empieza o termina una asignación. */
export function peakLoad(allocs: Slice[], from: number, to: number): { peak: number; day: number } {
  const days = new Set<number>([from]);
  for (const a of allocs) {
    if (a.start > from && a.start <= to) days.add(a.start);
    if (a.end + 1 > from && a.end + 1 <= to) days.add(a.end + 1);
  }
  let peak = 0; let at = from;
  for (const d of [...days].sort((x, y) => x - y)) {
    const l = loadOn(allocs, d);
    if (l > peak) { peak = l; at = d; }
  }
  return { peak, day: at };
}

export interface CapacitySummary { loadToday: number; freeToday: number; peakNext30: number; minFreeNext30: number }

/** Lo que ve ventas: cuánto está ocupado hoy y cuánto como máximo en los próximos 30 días (un ingeniero sobreasignado muestra 0 libre, nunca negativo). */
export function summarize(allocs: Slice[], today: number, horizonDays = 30): CapacitySummary {
  const loadToday = loadOn(allocs, today);
  const { peak } = peakLoad(allocs, today, today + horizonDays - 1);
  return { loadToday, freeToday: Math.max(0, 100 - loadToday), peakNext30: peak, minFreeNext30: Math.max(0, 100 - peak) };
}
