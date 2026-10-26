import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import s from './charts.module.css';
import { formatNumber } from './format';
import { SrOnly, Tooltip } from './parts';
import { extent, fraction, isFiniteNumber, round2 } from './scale';
import { useChartWidth } from './useChartWidth';
import { resolveT, type ChartTable, type I18nProps } from './types';

export interface HeatLine { id: string; label: string }
export interface HeatmapProps extends I18nProps {
  rows: readonly HeatLine[];
  cols: readonly HeatLine[];
  /** values[fila][columna]; null = sin dato (se dibuja vacío, nunca como cero). */
  values: readonly (readonly (number | null | undefined)[])[];
  /** Escribe el número de una celda (en el tooltip, la tabla y dentro de la celda). */
  valueFormat?: (n: number) => string;
  /** Fija los extremos de la escala (por defecto, el mínimo y el máximo de los datos). */
  min?: number;
  max?: number;
  /** Números dentro de las celdas. Por defecto solo si caben (celda de 26 px o más). */
  showValues?: boolean;
  ariaLabel: string;
  /** Texto de las etiquetas de las columnas cuando son muchas (cada cuántas se escribe una). */
  colEvery?: number;
}

/** Posición 0..1 → porcentaje de mezcla del color de la escala con la superficie (las celdas más bajas casi se funden con el fondo). */
export const heatMix = (frac: number): number => Math.round(10 + Math.min(1, Math.max(0, frac)) * 82);

/** Mapa de calor: filas × columnas con UN solo tono de claro a oscuro. El número está en la celda (si cabe), en el tooltip y en la tabla: el color nunca es el único canal. */
export function Heatmap({ rows, cols, values, valueFormat, min, max, showValues, ariaLabel, colEvery, ...i18n }: HeatmapProps) {
  const { lang, t } = resolveT(i18n);
  const { ref, width } = useChartWidth();
  const id = useId();
  const [pos, setPos] = useState<{ r: number; c: number } | null>(null);
  const fmt = valueFormat ?? ((n: number) => formatNumber(n, lang, 1));
  const at = (r: number, c: number): number | null => { const v = values[r]?.[c]; return isFiniteNumber(v) ? v : null; };
  const all = rows.flatMap((_r, r) => cols.map((_c, c) => at(r, c)));
  const e = extent(all);
  if (rows.length === 0 || cols.length === 0 || !e) return <div ref={ref} className={s.root}><svg className={s.svg} width="100%" height={120} role="img" aria-label={ariaLabel} /></div>;
  const lo = isFiniteNumber(min) ? min : e[0], hi = isFiniteNumber(max) ? max : e[1];

  const longest = Math.max(...rows.map((r) => r.label.length));
  const labelW = Math.min(width * 0.38, Math.max(48, longest * 6.4 + 12));
  const topH = 22;
  const cw = Math.max(8, (width - labelW - 4) / cols.length);
  const ch = Math.max(22, Math.min(34, cw));
  const H = topH + rows.length * ch + 4;
  const every = colEvery ?? Math.max(1, Math.ceil(36 / cw));
  const inside = showValues ?? cw >= 26;

  const move = (e2: KeyboardEvent<Element>) => {
    const cur = pos ?? { r: 0, c: 0 };
    const k = e2.key;
    const next = k === 'ArrowRight' ? { r: cur.r, c: Math.min(cols.length - 1, cur.c + (pos ? 1 : 0)) } : k === 'ArrowLeft' ? { r: cur.r, c: Math.max(0, cur.c - 1) }
      : k === 'ArrowDown' ? { r: Math.min(rows.length - 1, cur.r + (pos ? 1 : 0)), c: cur.c } : k === 'ArrowUp' ? { r: Math.max(0, cur.r - 1), c: cur.c }
        : k === 'Home' ? { r: cur.r, c: 0 } : k === 'End' ? { r: cur.r, c: cols.length - 1 } : null;
    if (k === 'Escape') { e2.preventDefault(); setPos(null); return; }
    if (next) { e2.preventDefault(); setPos(next); }
  };
  const cur = pos && pos.r < rows.length && pos.c < cols.length ? pos : null;
  const curVal = cur ? at(cur.r, cur.c) : null;
  const tipX = cur ? labelW + cur.c * cw + cw / 2 : 0;

  return (
    <div ref={ref} className={s.root}>
      <div style={{ position: 'relative' }}>
        <svg className={s.svg} width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={ariaLabel} aria-describedby={`${id}-hint`} tabIndex={0} onKeyDown={move} onBlur={() => setPos(null)} onPointerLeave={() => setPos(null)}>
          {cols.map((c, ci) => (ci % every === 0 ? <text key={c.id} className={s.axisText} x={round2(labelW + ci * cw + cw / 2)} y={14} textAnchor="middle"><title>{c.label}</title>{c.label}</text> : null))}
          {rows.map((r, ri) => (
            <g key={r.id}>
              <text className={s.labelText} x={labelW - 8} y={round2(topH + ri * ch + ch / 2) + 4} textAnchor="end"><title>{r.label}</title>{r.label.length * 6.4 > labelW - 12 ? `${r.label.slice(0, Math.max(1, Math.floor((labelW - 12) / 6.4) - 1))}…` : r.label}</text>
              {cols.map((c, ci) => {
                const v = at(ri, ci);
                const f = v === null ? 0 : fraction(v, lo, hi);
                const x = labelW + ci * cw, y = topH + ri * ch;
                const isCur = cur !== null && cur.r === ri && cur.c === ci;
                return (
                  <g key={c.id} className={s.cell} onPointerEnter={() => setPos({ r: ri, c: ci })} onPointerMove={() => setPos({ r: ri, c: ci })}>
                    <rect x={round2(x + 1)} y={round2(y + 1)} width={Math.max(1, round2(cw - 2))} height={Math.max(1, round2(ch - 2))} rx={3}
                      style={{ fill: v === null ? 'var(--surface-2)' : `color-mix(in oklab, var(--chart-seq) ${heatMix(f)}%, var(--surface))`, stroke: isCur ? 'var(--fg)' : 'none' }} strokeWidth={isCur ? 2 : 0}>
                      <title>{`${r.label} · ${c.label}: ${v === null ? t('chart.cellEmpty') : fmt(v)}`}</title>
                    </rect>
                    {inside && v !== null && <text x={round2(x + cw / 2)} y={round2(y + ch / 2) + 4} textAnchor="middle" className={s.valueText} style={{ fill: f > 0.55 ? 'var(--chart-on-seq)' : 'var(--fg)', pointerEvents: 'none' }}>{fmt(v)}</text>}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
        {cur && <Tooltip x={tipX} width={width} title={`${rows[cur.r].label} · ${cols[cur.c].label}`} rows={[{ id: 'v', label: '', value: curVal === null ? t('chart.cellEmpty') : fmt(curVal) }]} />}
        <SrOnly id={`${id}-hint`}>{t('chart.hint')}</SrOnly>
        <SrOnly live>{cur ? `${rows[cur.r].label}, ${cols[cur.c].label}: ${curVal === null ? t('chart.cellEmpty') : fmt(curVal)}` : ''}</SrOnly>
      </div>
    </div>
  );
}

/** Tabla alternativa del mapa de calor: una fila por fila y una columna por columna. */
export function heatmapTable(rows: readonly HeatLine[], cols: readonly HeatLine[], values: readonly (readonly (number | null | undefined)[])[], opts: I18nProps & { valueFormat?: (n: number) => string; caption?: string; rowHeader?: string } = {}): ChartTable {
  const { lang, t } = resolveT(opts);
  const fmt = opts.valueFormat ?? ((n: number) => formatNumber(n, lang, 1));
  return {
    caption: opts.caption,
    columns: [opts.rowHeader ?? t('chart.table.row'), ...cols.map((c) => c.label)],
    rows: rows.map((r, ri) => [r.label, ...cols.map((_c, ci) => { const v = values[ri]?.[ci]; return isFiniteNumber(v) ? fmt(v) : null; })]),
  };
}
