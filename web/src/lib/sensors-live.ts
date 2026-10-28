/** Cada cuánto se vuelve a pedir lo de Sensores mientras la pestaña se ve: ver 10 segundos es «en vivo» sin gastar el cupo de peticiones. */
export const SENSORS_REFRESH_MS = 10_000;

/** La antigüedad de un dato, en la unidad que se lee mejor: segundos hasta 59, minutos hasta 59, y luego horas. Nunca negativa. */
export function ageParts(ms: number): { unit: 's' | 'min' | 'h'; n: number } {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return { unit: 's', n: s };
  const m = Math.floor(s / 60);
  return m < 60 ? { unit: 'min', n: m } : { unit: 'h', n: Math.floor(m / 60) };
}

/**
 * Qué hacer con la tabla de lecturas cuando cambia el total de lecturas guardadas:
 *  - `silent`: está en la primera página, se vuelve a pedir en silencio (sin el «cargando…» que la hace parpadear);
 *  - `notice`: está en otra página, NO se mueve (las filas de debajo se correrían mientras la mira) y se avisa que hay lecturas nuevas;
 *  - `none`: no hay nada que hacer (todavía no cargó, o el total no cambió).
 */
export type TableRefresh = 'none' | 'silent' | 'notice';
export function tableRefresh(o: { ready: boolean; changed: boolean; offset: number }): TableRefresh {
  if (!o.ready || !o.changed) return 'none';
  return o.offset === 0 ? 'silent' : 'notice';
}

/** Cuántas lecturas llegaron desde que se abrió la pantalla (nunca negativo: un reset de la demo no debe mostrar «-4200»). */
export const addedSince = (firstTotal: number | null, total: number): number => (firstTotal === null ? 0 : Math.max(0, total - firstTotal));

/** Huella de lo que llegó, sin la hora del servidor (`asOf`, que cambia en cada respuesta): si es igual a la anterior no hay nada que volver a pintar. */
export const fingerprint = (...parts: unknown[]): string => JSON.stringify(parts, (k, v) => (k === 'asOf' ? undefined : v));
