import type { Lang } from '../i18n/core';
import type { TFn } from '../i18n';

const cop = new Intl.NumberFormat('es-CO');
/** Pesos: se escriben igual en los dos idiomas (es el formato de la moneda, no del idioma de la pantalla). */
export const formatCop = (n: number): string => cop.format(n);

// Se arman a mano: el abreviado del mes («Sep» o «Sept») y el separador de miles cambian según el motor del navegador.
const MONTHS: Record<Lang, string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
export const monthNames = MONTHS;
const two = (n: number) => String(n).padStart(2, '0');

/** Fecha de calendario en UTC (la misma zona en que el servidor calcula el vencimiento): «17 Nov 2026» en inglés y «17 nov 2026» en español. */
export function formatDay(iso: string, lang: Lang = 'en'): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Fecha y hora UTC: «13 Sep 2026, 11:14 UTC». */
export function formatInstant(iso: string, lang: Lang = 'en'): string {
  const d = new Date(iso);
  return `${formatDay(iso, lang)}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** Un conteo con separador de miles propio del idioma, fijo en todos los navegadores: 4.200 en español y 4,200 en inglés. */
export function formatCount(n: number, lang: Lang = 'en'): string {
  const sep = lang === 'es' ? '.' : ',';
  const neg = n < 0 ? '-' : '';
  return neg + String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function timeAgo(iso: string, nowMs: number, t: TFn): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 5) return t('time.justNow');
  if (s < 60) return t('time.secondsAgo', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('time.minutesAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('time.hoursAgo', { n: h });
  return t('time.daysAgo', { n: Math.round(h / 24) });
}

export const mmss = (secs: number): string => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
