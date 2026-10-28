/** Primeras `shown` filas y cuántas quedan sin mostrar (para «Mostrar más» en las tablas largas). */
export function pageOf<T>(list: T[], shown: number): { rows: T[]; hidden: number } {
  const n = Math.max(0, Math.floor(shown));
  return { rows: list.slice(0, n), hidden: Math.max(0, list.length - n) };
}
