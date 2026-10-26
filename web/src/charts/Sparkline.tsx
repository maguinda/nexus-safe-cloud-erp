import s from './charts.module.css';
import { areaPath, extent, isFiniteNumber, linePath, linearScale } from './scale';
import { toneColor, type Tone } from './types';

export interface SparklineProps {
  values: readonly (number | null | undefined)[];
  tone?: Tone;
  width?: number;
  height?: number;
  /** Resumen para el lector de pantalla («Temperatura de la última hora: de 21 a 24 °C»). Obligatorio: una mini línea sin texto no dice nada. */
  ariaLabel: string;
  /** Relleno suave bajo la línea. */
  area?: boolean;
}

/** Mini línea para tarjetas de cifra: sin ejes ni leyenda; solo la forma y un punto al final. */
export function Sparkline({ values, tone = 'chart-1', width = 96, height = 28, ariaLabel, area }: SparklineProps) {
  const e = extent(values);
  const color = toneColor(tone);
  const pad = 4;
  const clean = values.map((v) => (isFiniteNumber(v) ? v : null));
  const n = clean.length;
  if (!e || n === 0) return <svg className={s.svg} width={width} height={height} role="img" aria-label={ariaLabel} />;
  const x = linearScale(0, Math.max(1, n - 1), pad, width - pad);
  const y = linearScale(e[0], e[1], height - pad, pad);
  const pts = clean.map((v, i) => (v === null ? null : { x: x(i), y: y(v) }));
  const last = [...pts].reverse().find((p) => p !== null);
  return (
    <svg className={s.svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {area && <path d={areaPath(pts, height - pad)} style={{ fill: color }} opacity={0.12} />}
      <path className={s.line} d={linePath(pts)} style={{ stroke: color }} />
      {last && <circle cx={last.x} cy={last.y} r={3.5} style={{ fill: color, stroke: 'var(--surface)' }} strokeWidth={2} />}
    </svg>
  );
}
