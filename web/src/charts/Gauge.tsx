import { useId } from 'react';
import s from './charts.module.css';
import { formatNumber } from './format';
import { isFiniteNumber, linearScale, polar } from './scale';
import { SrOnly } from './parts';
import { resolveT, toneColor, type I18nProps } from './types';

export type GaugeTone = 'ok' | 'warn' | 'bad';
/** Un tramo del medidor: desde `from` (incluido) hasta el siguiente tramo. El primer tramo empieza en `min`. */
export interface GaugeBand { from: number; tone: GaugeTone }

/** El tono del tramo en el que cae un valor. `bands` se ordena por `from`; por debajo del primer tramo cuenta como el primero. */
export function gaugeTone(value: number, bands: readonly GaugeBand[]): GaugeTone {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  let tone: GaugeTone = sorted[0]?.tone ?? 'ok';
  for (const b of sorted) if (value >= b.from) tone = b.tone;
  return tone;
}

const ICON: Record<GaugeTone, string> = { ok: '✓', warn: '!', bad: '✕' };

export interface GaugeProps extends I18nProps {
  value: number;
  min?: number;
  max?: number;
  /** Tramos de estado (p. ej. 0–60 crítico, 60–85 atención, 85+ normal). Sin tramos el medidor usa el tono de acento. */
  bands?: readonly GaugeBand[];
  /** El valor ya escrito (p. ej. «86 %»). Por defecto, el número del idioma. */
  valueText?: string;
  /** Qué mide («Disponibilidad de la red»). */
  label: string;
  ariaLabel: string;
  size?: number;
}

/** Medidor semicircular. El estado se dice con ICONO Y TEXTO (✓ Normal, ! Atención, ✕ Crítico), nunca solo con el color. */
export function Gauge({ value, min = 0, max = 100, bands, valueText, label, ariaLabel, size = 220, ...i18n }: GaugeProps) {
  const { lang, t } = resolveT(i18n);
  const id = useId();
  const v = isFiniteNumber(value) ? Math.min(max, Math.max(min, value)) : min;
  const cx = size / 2, cy = size * 0.55, r = size / 2 - 14, w = 14;
  const toAngle = linearScale(min, max, -Math.PI / 2, Math.PI / 2);
  const arc = (a0: number, a1: number) => { const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1); return `M${p0.x} ${p0.y}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1.x} ${p1.y}`; };
  const tone = bands && bands.length ? gaugeTone(v, bands) : null;
  const color = tone ? toneColor(tone) : toneColor('chart-1');
  const a1 = toAngle(v);
  const bounds = bands ? [...bands].sort((a, b) => a.from - b.from).slice(1).map((b) => b.from).filter((x) => x > min && x < max) : [];
  return (
    <div>
      <svg className={s.svg} width="100%" viewBox={`0 0 ${size} ${size * 0.74}`} role="img" aria-label={ariaLabel} aria-describedby={`${id}-d`}>
        <path d={arc(-Math.PI / 2, Math.PI / 2)} fill="none" className={s.gaugeTrack} strokeWidth={w} strokeLinecap="round" />
        {a1 > -Math.PI / 2 + 0.01 && <path d={arc(-Math.PI / 2, a1)} fill="none" style={{ stroke: color }} strokeWidth={w} strokeLinecap="round" className={s.mark} />}
        {bounds.map((b) => { const a = toAngle(b); const p0 = polar(cx, cy, r - w / 2 - 3, a), p1 = polar(cx, cy, r + w / 2 + 3, a); return <line key={b} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className={s.axisLine} />; })}
        <text x={cx} y={cy - 6} textAnchor="middle" className={s.centerValue}>{valueText ?? formatNumber(value, lang, 1)}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" className={s.centerLabel}>{label}</text>
        <text x={cx - r} y={cy + 38} textAnchor="middle" className={s.axisText}>{formatNumber(min, lang, 0)}</text>
        <text x={cx + r} y={cy + 38} textAnchor="middle" className={s.axisText}>{formatNumber(max, lang, 0)}</text>
      </svg>
      {tone && <p className={s.statusLineCentered}><span aria-hidden style={{ color }}>{ICON[tone]}</span><span>{t(`chart.gauge.${tone}`)}</span></p>}
      <SrOnly id={`${id}-d`}>{`${label}: ${valueText ?? formatNumber(value, lang, 1)}${tone ? `, ${t(`chart.gauge.${tone}`)}` : ''}`}</SrOnly>
    </div>
  );
}
