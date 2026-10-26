import { useId } from 'react';
import s from './charts.module.css';
import { formatNumber, formatPercent } from './format';
import { Legend, SrOnly } from './parts';
import { isFiniteNumber, ringPath } from './scale';
import { useActive } from './useActive';
import { resolveT, seriesTone, toneColor, type ChartTable, type I18nProps, type LegendItem, type Tone } from './types';

export interface DonutSlice { id: string; label: string; value: number; tone?: Tone }

/**
 * Se quedan las `max - 1` porciones más grandes (o `max` si caben) y el resto se agrupa en «Otros»: un 7.º color nunca se inventa.
 * Ignora valores que no sean positivos y finitos. El orden de salida es de mayor a menor, con «Otros» al final.
 */
export function foldSlices(slices: readonly DonutSlice[], otherLabel: string, max = 6): DonutSlice[] {
  const clean = slices.filter((x) => isFiniteNumber(x.value) && x.value > 0).sort((a, b) => b.value - a.value);
  if (clean.length <= max) return clean;
  const keep = clean.slice(0, max - 1);
  const rest = clean.slice(max - 1);
  return [...keep, { id: '__other', label: otherLabel, value: rest.reduce((n, r) => n + r.value, 0), tone: 'chart-other' }];
}

export interface DonutProps extends I18nProps {
  slices: readonly DonutSlice[];
  /** Resumen del hallazgo para el lector de pantalla: «Equipos por criticidad: 5 críticos, 5 altos y 66 medios». */
  ariaLabel: string;
  /** Texto grande al centro (por defecto, el total) y su etiqueta. */
  centerValue?: string;
  centerLabel?: string;
  /** Cómo se escribe un valor en la leyenda y el tooltip (por defecto, número del idioma sin decimales). */
  valueFormat?: (n: number) => string;
  size?: number;
}

/** Anillo con el total al centro y una leyenda con valor y porcentaje. Al pasar o enfocar una porción, el centro muestra la suya. */
export function Donut({ slices, ariaLabel, centerValue, centerLabel, valueFormat, size = 200, ...i18n }: DonutProps) {
  const { lang, t } = resolveT(i18n);
  const fmt = valueFormat ?? ((n: number) => formatNumber(n, lang, 0));
  const folded = foldSlices(slices, t('chart.donut.other'));
  const total = folded.reduce((n, x) => n + x.value, 0);
  const { active, setActive } = useActive(folded.length);
  const id = useId();
  const cx = size / 2, cy = size / 2, rO = size / 2 - 4, rI = rO * 0.64;
  const items: LegendItem[] = folded.map((x, i) => ({ id: x.id, label: x.label, tone: x.tone ?? seriesTone(i), shape: 'box', value: `${fmt(x.value)} · ${formatPercent((x.value / total) * 100, lang, 0)}` }));
  const gap = (2 / ((rO + rI) / 2)); // 2 px de aire entre porciones, en radianes
  let angle = 0;
  const arcs = folded.map((x, i) => {
    const sweep = (x.value / total) * Math.PI * 2;
    const a0 = angle + (folded.length > 1 ? gap / 2 : 0), a1 = angle + sweep - (folded.length > 1 ? gap / 2 : 0);
    angle += sweep;
    return { x, i, d: ringPath(cx, cy, rO, rI, a0, Math.max(a0 + 0.001, a1)) };
  });
  const shown = active !== null ? folded[active] : null;
  return (
    <div className={s.pair}>
      <div className={s.pairChart}>
        <svg className={s.svg} width="100%" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel} aria-describedby={`${id}-d`}>
          {arcs.map(({ x, i, d }) => (
            <path key={x.id} d={d} className={`${s.mark} ${active !== null && active !== i ? s.dim : ''}`} style={{ fill: toneColor(x.tone ?? seriesTone(i)) }} onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}>
              <title>{`${x.label}: ${fmt(x.value)} (${formatPercent((x.value / total) * 100, lang, 1)})`}</title>
            </path>
          ))}
          <text x={cx} y={cy - 2} textAnchor="middle" className={s.centerValue}>{shown ? fmt(shown.value) : (centerValue ?? fmt(total))}</text>
          <text x={cx} y={cy + 16} textAnchor="middle" className={s.centerLabel}>{shown ? shown.label : (centerLabel ?? t('chart.donut.total'))}</text>
        </svg>
        <SrOnly id={`${id}-d`}>{folded.map((x) => `${x.label}: ${fmt(x.value)}`).join('; ')}</SrOnly>
      </div>
      <div className={s.pairLegend}><Legend items={items} label={t('chart.legend')} activeId={shown?.id ?? null} onActive={(sid) => setActive(sid === null ? null : folded.findIndex((x) => x.id === sid))} /></div>
    </div>
  );
}

/** Tabla alternativa del anillo: categoría, valor y participación. */
export function donutTable(slices: readonly DonutSlice[], opts: I18nProps & { valueFormat?: (n: number) => string; caption?: string } = {}): ChartTable {
  const { lang, t } = resolveT(opts);
  const fmt = opts.valueFormat ?? ((n: number) => formatNumber(n, lang, 0));
  const folded = foldSlices(slices, t('chart.donut.other'));
  const total = folded.reduce((n, x) => n + x.value, 0);
  return { caption: opts.caption, columns: [t('chart.table.category'), t('chart.table.value'), t('chart.table.share')], rows: folded.map((x) => [x.label, fmt(x.value), formatPercent((x.value / total) * 100, lang, 1)]) };
}
