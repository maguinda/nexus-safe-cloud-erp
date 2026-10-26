import { Lang, MsgKey, translate } from '../i18n';
import { formatDay } from './format';
import type { DeviceState, TelemetryDevice } from './types';

/** Estado de un dispositivo -> clave del diccionario (`t(STATE_KEY[state])`): el nombre del estado se traduce, el estado crudo del sensor no. */
export const STATE_KEY: Record<DeviceState, MsgKey> = { normal: 'iot.state.normal', warning: 'iot.state.warning', alert: 'iot.state.alert', no_data: 'iot.state.no_data' };

const two = (n: number) => String(n).padStart(2, '0');

/** Una cifra con a lo sumo un decimal, sin ceros de relleno: 24 → «24», 22.46 → «22.5» en inglés y «22,5» en español. */
export const num1 = (n: number, lang: Lang = 'en'): string => {
  const s = String(Math.round(n * 10) / 10);
  return lang === 'es' ? s.replace('.', ',') : s;
};

/** Lo que se lee en pantalla: las señales de sí/no (unidad BOOL) se muestran con su estado crudo («LOCKED», dato de la base), el resto con su unidad. */
export function readingLabel(d: Pick<TelemetryDevice, 'unit' | 'lastValue' | 'lastStatus'>, lang: Lang = 'en'): string {
  if (d.lastValue === null) return '—';
  if (d.unit === 'BOOL') return d.lastStatus ?? '—';
  return `${num1(d.lastValue, lang)} ${d.unit}`;
}

/** «13 Sep 2026, 08:01–11:20 UTC» (las marcas de la fuente no traen zona horaria y se leen como UTC). La fecha sale de `formatDay`, armada a mano. */
export function windowLabel(w: { from: string; to: string } | null, lang: Lang = 'en'): string {
  if (!w) return translate(lang, 'iot.noReadings');
  const from = new Date(w.from), to = new Date(w.to);
  const day = (iso: string) => formatDay(iso, lang);
  const hm = (d: Date) => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  return day(w.from) === day(w.to) ? `${day(w.from)}, ${hm(from)}–${hm(to)} UTC` : `${day(w.from)} ${hm(from)} – ${day(w.to)} ${hm(to)} UTC`;
}

export const avgLabel = (n: number | null, unit: string, lang: Lang = 'en'): string => (n === null ? '—' : `${num1(n, lang)} ${unit}`);
