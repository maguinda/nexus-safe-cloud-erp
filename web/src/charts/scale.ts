/**
 * Funciones PURAS de los gráficos: escalas, ticks, ejes de tiempo y geometría. No leen React, ni el DOM, ni el idioma.
 * Regla de la librería: un valor que no es un número finito (NaN, Infinity, null, undefined) NO se dibuja; se descarta aquí, una sola vez,
 * para que ningún `NaN` llegue a un atributo del SVG.
 */

export const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Mínimo y máximo de los valores finitos; null si no hay ninguno. */
export function extent(values: readonly unknown[]): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (isFiniteNumber(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return lo === Infinity ? null : [lo, hi];
}

/** Número «redondo» (1, 2, 2,5, 5 o 10 por una potencia de 10) cercano a x: con `round` el más cercano, sin él el siguiente por arriba. */
function niceNumber(x: number, round: boolean): number {
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** exp;
}

/** Cuántos decimales hacen falta para escribir un paso sin ruido de coma flotante (0,1 + 0,2). */
function decimalsOf(step: number): number {
  for (let d = 0; d < 9; d++) if (Math.abs(step - Number(step.toFixed(d))) < 1e-9) return d;
  return 9;
}

/** Ticks redondos que CUBREN [min, max]. Con min = max se abre un rango mínimo para que haya eje. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isFiniteNumber(min) || !isFiniteNumber(max)) return [];
  let lo = Math.min(min, max), hi = Math.max(min, max);
  if (lo === hi) { const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1; lo -= pad; hi += pad; }
  const range = niceNumber(hi - lo, false);
  const step = niceNumber(range / Math.max(1, count - 1), true);
  const first = Math.floor(lo / step + 1e-9) * step;
  const last = Math.ceil(hi / step - 1e-9) * step;
  const digits = decimalsOf(step);
  const out: number[] = [];
  for (let v = first, i = 0; v <= last + step / 2 && i < 200; v = first + (++i) * step) out.push(Number(v.toFixed(digits)));
  return out;
}

export interface NiceDomain { min: number; max: number; ticks: number[] }

/**
 * Dominio del eje Y a partir de los valores. `includeZero` fuerza el cero en el eje (las barras SIEMPRE lo llevan: su longitud es el dato).
 * `min`/`max` fijan un extremo (p. ej. un porcentaje de 0 a 100). Sin valores finitos devuelve un dominio 0..1.
 */
export function niceDomain(values: readonly unknown[], opts: { includeZero?: boolean; count?: number; min?: number; max?: number } = {}): NiceDomain {
  const e = extent(values);
  let lo = e ? e[0] : 0, hi = e ? e[1] : 1;
  if (opts.includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (isFiniteNumber(opts.min)) lo = Math.min(lo, opts.min);
  if (isFiniteNumber(opts.max)) hi = Math.max(hi, opts.max);
  const ticks = niceTicks(lo, hi, opts.count ?? 5);
  if (ticks.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  return { min: isFiniteNumber(opts.min) ? opts.min : ticks[0], max: isFiniteNumber(opts.max) ? opts.max : ticks[ticks.length - 1], ticks: ticks.filter((t) => t >= (isFiniteNumber(opts.min) ? opts.min : -Infinity) && t <= (isFiniteNumber(opts.max) ? opts.max : Infinity)) };
}

/** Escala lineal d0..d1 -> r0..r1. Con dominio de un solo valor devuelve el punto medio del rango (nunca divide entre cero). */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (!isFiniteNumber(span) || span === 0) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const STEPS = [MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 30 * DAY];

/** Ticks de tiempo alineados a UTC (múltiplos del paso desde la época): 08:00, 08:30… Devuelve como mucho ~`target` marcas dentro del rango. */
export function timeTicks(fromMs: number, toMs: number, target = 6): number[] {
  if (!isFiniteNumber(fromMs) || !isFiniteNumber(toMs)) return [];
  const lo = Math.min(fromMs, toMs), hi = Math.max(fromMs, toMs);
  if (lo === hi) return [lo];
  // El paso más fino que no pase de `target + 1` marcas (así 08:01–11:20 da 08:30, 09:00… y no solo 09:00, 10:00, 11:00).
  const count = (st: number) => Math.floor(hi / st) - Math.ceil(lo / st) + 1;
  const step = STEPS.find((st) => count(st) <= Math.max(2, target) + 1) ?? STEPS[STEPS.length - 1];
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi && out.length < 60; t += step) out.push(t);
  return out.length ? out : [lo, hi];
}

/** Reparte `n` marcas en un ancho: grosor máximo `maxThickness`, separadas por el aire que sobre (nunca llenan su banda). */
export function bandLayout(n: number, size: number, maxThickness: number, innerPad = 0.3): { step: number; thickness: number; offset: (i: number) => number } {
  const count = Math.max(1, Math.floor(n));
  const step = size / count;
  const thickness = Math.max(1, Math.min(maxThickness, step * (1 - innerPad)));
  return { step, thickness, offset: (i) => i * step + (step - thickness) / 2 };
}

/** Trazo de una línea; un `null` corta la línea (hueco en los datos) en vez de unir los puntos a través del vacío. */
export function linePath(points: readonly ({ x: number; y: number } | null)[]): string {
  let d = '', pen = false;
  for (const p of points) {
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${round2(p.x)} ${round2(p.y)}`;
    pen = true;
  }
  return d;
}

/** Área bajo una línea hasta `baseline` (un tramo continuo por vez; los huecos separan tramos). */
export function areaPath(points: readonly ({ x: number; y: number } | null)[], baseline: number): string {
  const runs: { x: number; y: number }[][] = [[]];
  for (const p of points) { if (p && isFiniteNumber(p.x) && isFiniteNumber(p.y)) runs[runs.length - 1].push(p); else if (runs[runs.length - 1].length) runs.push([]); }
  return runs.filter((r) => r.length > 0).map((r) => `M${round2(r[0].x)} ${round2(baseline)}${r.map((p) => `L${round2(p.x)} ${round2(p.y)}`).join('')}L${round2(r[r.length - 1].x)} ${round2(baseline)}Z`).join('');
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Punto sobre una circunferencia; el ángulo va en radianes desde las 12 en punto, en sentido horario. */
export const polar = (cx: number, cy: number, r: number, angle: number): { x: number; y: number } => ({ x: round2(cx + r * Math.sin(angle)) + 0, y: round2(cy - r * Math.cos(angle)) + 0 }); // «+ 0» convierte -0 en 0

/** Sector de anillo entre dos ángulos (radianes desde las 12 en punto, horario). Un sector de vuelta completa se parte en dos mitades. */
export function ringPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  if (!(rOuter > rInner) || !isFiniteNumber(a0) || !isFiniteNumber(a1) || a1 <= a0) return '';
  if (a1 - a0 >= Math.PI * 2 - 1e-6) return `${ringPath(cx, cy, rOuter, rInner, a0, a0 + Math.PI)}${ringPath(cx, cy, rOuter, rInner, a0 + Math.PI, a0 + Math.PI * 2 - 1e-4)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = polar(cx, cy, rOuter, a0), o1 = polar(cx, cy, rOuter, a1), i1 = polar(cx, cy, rInner, a1), i0 = polar(cx, cy, rInner, a0);
  return `M${o0.x} ${o0.y}A${rOuter} ${rOuter} 0 ${large} 1 ${o1.x} ${o1.y}L${i1.x} ${i1.y}A${rInner} ${rInner} 0 ${large} 0 ${i0.x} ${i0.y}Z`;
}

/** Variación porcentual de `prev` a `curr`. null si no se puede calcular (sin dato previo, o previo = 0). */
export function changePct(prev: unknown, curr: unknown): number | null {
  if (!isFiniteNumber(prev) || !isFiniteNumber(curr) || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

/** Posición 0..1 de un valor dentro de [min, max], acotada (para escalas secuenciales). Con rango nulo devuelve 1 si hay valor. */
export function fraction(v: number, min: number, max: number): number {
  if (!isFiniteNumber(v)) return 0;
  if (max === min) return v > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

/** Evita que dos etiquetas se pisen: ordena por posición y las separa al menos `gap` px dentro de [lo, hi]. Devuelve las posiciones en el MISMO orden de entrada. */
export function spreadLabels(positions: readonly number[], gapWanted: number, lo: number, hi: number): number[] {
  // Si no caben todas con la separación pedida, se aprieta la separación (antes que sacar una etiqueta de la caja).
  const gap = positions.length > 1 ? Math.min(gapWanted, (hi - lo) / (positions.length - 1)) : gapWanted;
  const order = positions.map((p, i) => ({ p: isFiniteNumber(p) ? p : lo, i })).sort((a, b) => a.p - b.p);
  for (let k = 0; k < order.length; k++) { order[k].p = Math.max(lo, k === 0 ? order[k].p : Math.max(order[k].p, order[k - 1].p + gap)); }
  for (let k = order.length - 1; k >= 0; k--) { order[k].p = Math.min(hi - (order.length - 1 - k) * gap, order[k].p); }
  const out: number[] = new Array(order.length);
  for (const o of order) out[o.i] = o.p;
  return out;
}
