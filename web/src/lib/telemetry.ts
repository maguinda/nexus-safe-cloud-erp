import type { DeviceState, TelemetryDevice } from './types';

export const STATE_LABEL: Record<DeviceState, string> = { normal: 'Normal', warning: 'Warning', alert: 'Alert', no_data: 'No data' };

const grouped = new Intl.NumberFormat('en-US');
/** Un conteo con separador de miles fijo («4,200»): el formato en español cambia según el navegador («4200» o «4.200»). */
export const count = (n: number): string => grouped.format(n);

/** Una cifra con a lo sumo un decimal, sin ceros de relleno: 24 → «24», 22.46 → «22.5». */
export const num1 = (n: number): string => String(Math.round(n * 10) / 10);

/** Lo que se lee en pantalla: las señales de sí/no (unidad BOOL) se muestran con su estado («LOCKED»), el resto con su unidad. */
export function readingLabel(d: Pick<TelemetryDevice, 'unit' | 'lastValue' | 'lastStatus'>): string {
  if (d.lastValue === null) return '—';
  if (d.unit === 'BOOL') return d.lastStatus ?? '—';
  return `${num1(d.lastValue)} ${d.unit}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** «13 Sep 2026, 08:01–11:20 UTC» (las marcas de la fuente no traen zona horaria y se leen como UTC). Se arma a mano: el abreviado del mes («Sep» o «Sept») cambia según el motor del navegador. */
export function windowLabel(w: { from: string; to: string } | null): string {
  if (!w) return 'no readings loaded';
  const from = new Date(w.from), to = new Date(w.to);
  const day = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const hm = (d: Date) => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  return day(from) === day(to) ? `${day(from)}, ${hm(from)}–${hm(to)} UTC` : `${day(from)} ${hm(from)} – ${day(to)} ${hm(to)} UTC`;
}

/** «13 Sep 2026, 11:14 UTC»: un instante, en UTC. */
export function atLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

export const avgLabel = (n: number | null, unit: string): string => (n === null ? '—' : `${num1(n)} ${unit}`);
