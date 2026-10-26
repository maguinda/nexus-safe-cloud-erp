import type { Lang } from '../i18n/core';
import { monthNames } from '../lib/format';

/**
 * Formato de números y fechas de los gráficos, por idioma y SIN depender del navegador (Intl cambia entre motores):
 * español 1.234,5 · inglés 1,234.5. Todo en UTC, igual que el resto de la app.
 */
const sep = (lang: Lang) => (lang === 'es' ? { thousands: '.', decimal: ',' } : { thousands: ',', decimal: '.' });

/** Número con separador de miles y hasta `decimals` decimales (sin ceros de relleno). Lo que no es finito se escribe «—». */
export function formatNumber(n: unknown, lang: Lang = 'en', decimals = 1): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const s = sep(lang);
  const fixed = Math.abs(n).toFixed(Math.max(0, Math.min(6, decimals)));
  let [int, frac = ''] = fixed.split('.');
  frac = frac.replace(/0+$/, '');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, s.thousands);
  const neg = n < 0 && (Number(int.replace(/\D/g, '')) > 0 || frac) ? '-' : '';
  return `${neg}${int}${frac ? s.decimal + frac : ''}`;
}

/** Marca de eje compacta: 0 / 1K / 2,5K / 1M. Bajo 1.000 usa el número normal. */
export function formatTick(n: unknown, lang: Lang = 'en'): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${formatNumber(n / 1e9, lang, 1)}B`;
  if (a >= 1e6) return `${formatNumber(n / 1e6, lang, 1)}M`;
  if (a >= 1e3) return `${formatNumber(n / 1e3, lang, 1)}K`;
  return formatNumber(n, lang, 2);
}

/** Porcentaje con un decimal: 12,5 % (con espacio fino en español, como la app). */
export const formatPercent = (n: unknown, lang: Lang = 'en', decimals = 1): string => (typeof n === 'number' && Number.isFinite(n) ? `${formatNumber(n, lang, decimals)}${lang === 'es' ? ' %' : '%'}` : '—');

const two = (n: number) => String(n).padStart(2, '0');

/** «08:30» en UTC. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** «13 sep» / «13 Sep» en UTC. */
export function formatDayMonth(ms: number, lang: Lang = 'en'): string {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${d.getUTCDate()} ${monthNames[lang][d.getUTCMonth()]}`;
}

/** Marca del eje de tiempo: solo la hora si el rango cabe en 36 h; si no, el día (y la hora cuando cae a una hora que no es medianoche). */
export function formatTimeTick(ms: number, spanMs: number, lang: Lang = 'en'): string {
  if (spanMs <= 36 * 3_600_000) return formatClock(ms);
  const d = new Date(ms);
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? formatDayMonth(ms, lang) : `${formatDayMonth(ms, lang)} ${formatClock(ms)}`;
}

/** Fecha y hora completas para el tooltip y la tabla: «13 sep 2026, 11:14 UTC». */
export function formatInstantMs(ms: number, lang: Lang = 'en'): string {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${d.getUTCDate()} ${monthNames[lang][d.getUTCMonth()]} ${d.getUTCFullYear()}, ${formatClock(ms)} UTC`;
}
