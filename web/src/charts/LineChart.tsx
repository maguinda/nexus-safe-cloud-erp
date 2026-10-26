import { useId } from 'react';
import type { PointerEvent } from 'react';
import s from './charts.module.css';
import { formatInstantMs, formatNumber, formatTick, formatTimeTick } from './format';
import { Legend, SrOnly, Tooltip, type TooltipRow } from './parts';
import { areaPath, extent, isFiniteNumber, linePath, linearScale, niceDomain, round2, spreadLabels, timeTicks } from './scale';
import { useActive } from './useActive';
import { useChartWidth } from './useChartWidth';
import { resolveT, seriesTone, toneColor, type ChartTable, type I18nProps, type LegendItem, type Tone } from './types';

export interface LinePoint { x: number; y: number | null | undefined }
export interface LineSeries {
  id: string;
  label: string;
  points: readonly LinePoint[];
  /** Por defecto, el tono de su posición (fijo, sin repetirse). */
  tone?: Tone;
  dashed?: boolean;
  /** Relleno suave bajo la línea (útil con UNA serie). */
  area?: boolean;
}
/** Una línea horizontal de referencia con su etiqueta («Umbral 24 °C»). */
export interface LineThreshold { y: number; label: string }
/** Banda entre un mínimo y un máximo en cada x (p. ej. la temperatura mínima y máxima de la oficina). */
export interface LineBand { label: string; tone?: Tone; points: readonly { x: number; lower: number; upper: number }[] }
/** Un hecho puntual sobre la línea (una alerta): se dibuja como rombo y sale en el tooltip. */
export interface LineMarker { x: number; y: number; label: string; tone?: Tone }

export interface LineChartProps extends I18nProps {
  series: readonly LineSeries[];
  thresholds?: readonly LineThreshold[];
  band?: LineBand;
  markers?: readonly LineMarker[];
  /** 'time': x son milisegundos UTC (eje con horas). 'index': x son posiciones 0..n-1 y `xLabel` da el texto. */
  xKind?: 'time' | 'index';
  xLabel?: (x: number) => string;
  /** Cómo se escribe un valor en el tooltip y la tabla (los ticks del eje usan una forma compacta). */
  yFormat?: (n: number) => string;
  yDomain?: { min?: number; max?: number; includeZero?: boolean };
  /** El hallazgo en una frase, para el lector de pantalla: «La temperatura de la Oficina 3 supera 24 °C desde las 10:44». */
  ariaLabel: string;
  height?: number;
}

const MIN_END_LABEL_WIDTH = 440;

/** Gráfico de líneas con eje de tiempo o de categorías, umbrales, banda, eventos y lectura por cursor y por teclado (← →). */
export function LineChart({ series, thresholds = [], band, markers = [], xKind = 'time', xLabel, yFormat, yDomain, ariaLabel, height = 260, ...i18n }: LineChartProps) {
  const { lang, t } = resolveT(i18n);
  const { ref, width } = useChartWidth();
  const id = useId();

  // 1) Datos limpios: solo puntos finitos, ordenados; un `null`/`undefined` de y deja un hueco en la línea.
  const cleaned = series.map((sr, i) => {
    const byX = new Map<number, number | null>();
    for (const p of sr.points) if (isFiniteNumber(p.x)) byX.set(p.x, isFiniteNumber(p.y) ? p.y : null);
    return { ...sr, tone: sr.tone ?? seriesTone(i), byX };
  });
  const bandPts = (band?.points ?? []).filter((p) => isFiniteNumber(p.x) && isFiniteNumber(p.lower) && isFiniteNumber(p.upper)).sort((a, b) => a.x - b.x);
  const goodMarkers = markers.filter((m) => isFiniteNumber(m.x) && isFiniteNumber(m.y));
  const xs = [...new Set([...cleaned.flatMap((sr) => [...sr.byX.keys()]), ...bandPts.map((p) => p.x)])].sort((a, b) => a - b);
  const { active, setActive, onKeyDown, clear } = useActive(xs.length);
  const hasValues = cleaned.some((sr) => [...sr.byX.values()].some((v) => v !== null));
  if (xs.length === 0 || !hasValues) return <div ref={ref} className={s.root}><svg className={s.svg} width="100%" height={height} role="img" aria-label={ariaLabel} /></div>;

  // 2) Dominios.
  const [x0raw, x1raw] = extent(xs) as [number, number];
  const pad = x0raw === x1raw ? (xKind === 'time' ? 30 * 60_000 : 0.5) : 0;
  const xMin = x0raw - pad, xMax = x1raw + pad;
  const yValues = [...cleaned.flatMap((sr) => [...sr.byX.values()]), ...thresholds.map((th) => th.y), ...bandPts.flatMap((p) => [p.lower, p.upper]), ...goodMarkers.map((m) => m.y)];
  const dom = niceDomain(yValues, { includeZero: yDomain?.includeZero, min: yDomain?.min, max: yDomain?.max, count: Math.max(3, Math.round(height / 52)) });
  const yFmt = yFormat ?? ((n: number) => formatNumber(n, lang, 2));
  const tickFmt = (n: number) => formatTick(n, lang);

  // 3) Márgenes: el eje Y según sus etiquetas, y a la derecha sitio para las etiquetas directas si caben.
  const labelsOnEnd = cleaned.length <= 4 && width >= MIN_END_LABEL_WIDTH;
  const longest = Math.max(0, ...cleaned.map((sr) => Math.min(sr.label.length, 16)));
  const m = { l: Math.max(30, Math.max(...dom.ticks.map((tk) => tickFmt(tk).length)) * 6.6 + 12), r: labelsOnEnd ? Math.min(120, longest * 6.4 + 18) : 14, t: 14, b: 28 };
  const plotW = Math.max(40, width - m.l - m.r), plotH = Math.max(40, height - m.t - m.b);
  const X = linearScale(xMin, xMax, m.l, m.l + plotW), Y = linearScale(dom.min, dom.max, m.t + plotH, m.t);
  const xTicks = xKind === 'time' ? timeTicks(xMin, xMax, Math.max(2, Math.floor(plotW / 84))) : xs.filter((_, i) => i % Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(plotW / 64)))) === 0);
  const span = xMax - xMin;
  const xTickText = (v: number) => (xKind === 'time' ? formatTimeTick(v, span, lang) : (xLabel ? xLabel(v) : formatNumber(v, lang, 0)));
  const xFull = (v: number) => (xKind === 'time' ? formatInstantMs(v, lang) : (xLabel ? xLabel(v) : formatNumber(v, lang, 0)));

  // 4) Lo que dibuja cada serie.
  const paths = cleaned.map((sr) => {
    const pts = xs.map((x) => { const v = sr.byX.get(x); return v === undefined || v === null ? null : { x: X(x), y: Y(v) }; });
    const last = [...pts].reverse().find((p) => p !== null) ?? null;
    return { sr, pts, last, d: linePath(pts), area: sr.area ? areaPath(pts, Y(Math.max(dom.min, Math.min(0, dom.max)))) : '' };
  });
  const endY = labelsOnEnd ? spreadLabels(paths.map((p) => (p.last ? p.last.y : m.t)), 14, m.t + 6, m.t + plotH) : [];

  // 5) Lectura activa: valores de cada serie en esa x, y los eventos que caen ahí.
  const ax = active !== null ? xs[active] : null;
  const rows: TooltipRow[] = ax === null ? [] : [
    ...cleaned.map((sr) => { const v = sr.byX.get(ax); return { id: sr.id, tone: sr.tone, label: sr.label, value: v === undefined || v === null ? '—' : yFmt(v) }; }),
    ...(band ? bandPts.filter((p) => p.x === ax).map((p) => ({ id: '__band', tone: band.tone ?? 'chart-1', label: band.label, value: `${yFmt(p.lower)} – ${yFmt(p.upper)}` })) : []),
    ...goodMarkers.filter((mk) => mk.x === ax).map((mk, i) => ({ id: `__mk${i}`, tone: mk.tone ?? 'bad', label: mk.label, value: yFmt(mk.y) })),
  ];
  const onPointerMove = (e: PointerEvent<SVGElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)).getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = 0, bd = Infinity;
    xs.forEach((x, i) => { const d = Math.abs(X(x) - px); if (d < bd) { bd = d; best = i; } });
    setActive(best);
  };
  const legend: LegendItem[] = [
    ...cleaned.map((sr) => ({ id: sr.id, label: sr.label, tone: sr.tone, shape: 'line' as const, dashed: sr.dashed })),
    ...(band ? [{ id: '__band', label: band.label, tone: band.tone ?? ('chart-1' as Tone), shape: 'box' as const }] : []),
    ...(goodMarkers.length ? [{ id: '__markers', label: [...new Set(goodMarkers.map((mk) => mk.label))].slice(0, 2).join(' / '), tone: goodMarkers[0].tone ?? ('bad' as Tone), shape: 'dot' as const }] : []),
  ];

  return (
    <div ref={ref} className={s.root}>
      {legend.length >= 2 && <Legend items={legend} label={t('chart.legend')} />}
      <div className={legend.length >= 2 ? s.plotWithLegend : s.plot}>
        <svg
          className={s.svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} aria-describedby={`${id}-hint`}
          tabIndex={0} onKeyDown={onKeyDown} onBlur={clear} onPointerLeave={clear}
        >
          {dom.ticks.map((tk) => (
            <g key={tk}>
              <line className={s.gridLine} x1={m.l} x2={m.l + plotW} y1={round2(Y(tk))} y2={round2(Y(tk))} />
              <text className={s.axisText} x={m.l - 8} y={round2(Y(tk)) + 4} textAnchor="end">{tickFmt(tk)}</text>
            </g>
          ))}
          {xTicks.map((tk) => <text key={tk} className={s.axisText} x={round2(X(tk))} y={height - 8} textAnchor="middle">{xTickText(tk)}</text>)}
          <line className={s.axisLine} x1={m.l} x2={m.l + plotW} y1={m.t + plotH} y2={m.t + plotH} />

          {band && bandPts.length > 0 && (
            <path d={`${linePath(bandPts.map((p) => ({ x: X(p.x), y: Y(p.upper) })))}${[...bandPts].reverse().map((p) => `L${round2(X(p.x))} ${round2(Y(p.lower))}`).join('')}Z`} style={{ fill: toneColor(band.tone ?? 'chart-1') }} opacity={0.14} />
          )}
          {thresholds.filter((th) => isFiniteNumber(th.y)).map((th) => (
            <g key={`${th.label}-${th.y}`}>
              <line className={s.thresholdLine} x1={m.l} x2={m.l + plotW} y1={round2(Y(th.y))} y2={round2(Y(th.y))} />
              <text className={s.thresholdText} x={m.l + plotW - 4} y={round2(Y(th.y)) - 5} textAnchor="end">{th.label}</text>
            </g>
          ))}

          {paths.map(({ sr, d, area }) => (
            <g key={sr.id}>
              {area && <path d={area} style={{ fill: toneColor(sr.tone) }} opacity={0.12} />}
              <path className={s.line} d={d} style={{ stroke: toneColor(sr.tone) }} strokeDasharray={sr.dashed ? '2 5' : undefined} />
            </g>
          ))}
          {goodMarkers.map((mk, i) => (
            <rect key={i} x={round2(X(mk.x)) - 4.5} y={round2(Y(mk.y)) - 4.5} width={9} height={9} transform={`rotate(45 ${round2(X(mk.x))} ${round2(Y(mk.y))})`} className={s.ring} style={{ fill: toneColor(mk.tone ?? 'bad') }} strokeWidth={2}><title>{`${mk.label}: ${yFmt(mk.y)}`}</title></rect>
          ))}
          {paths.map(({ sr, last }, i) => last && (
            <g key={`end-${sr.id}`}>
              <circle cx={last.x} cy={last.y} r={4} className={s.ring} style={{ fill: toneColor(sr.tone) }} strokeWidth={2} />
              {labelsOnEnd && <text className={s.labelText} x={last.x + 10} y={round2(endY[i]) + 4}>{sr.label.length > 16 ? `${sr.label.slice(0, 15)}…` : sr.label}</text>}
            </g>
          ))}

          {ax !== null && (
            <g>
              <line className={s.crosshair} x1={round2(X(ax))} x2={round2(X(ax))} y1={m.t} y2={m.t + plotH} />
              {cleaned.map((sr) => { const v = sr.byX.get(ax); return v === undefined || v === null ? null : <circle key={sr.id} cx={round2(X(ax))} cy={round2(Y(v))} r={4} className={s.ring} style={{ fill: toneColor(sr.tone) }} strokeWidth={2} />; })}
            </g>
          )}
          <rect className={s.hit} x={m.l} y={m.t} width={plotW} height={plotH} onPointerMove={onPointerMove} />
        </svg>
        {ax !== null && <Tooltip x={X(ax)} width={width} title={xFull(ax)} rows={rows} />}
        <SrOnly id={`${id}-hint`}>{t('chart.hint')}</SrOnly>
        <SrOnly live>{ax === null ? '' : `${t('chart.reading', { at: xFull(ax) })}: ${rows.map((r) => `${r.label} ${r.value}`).join('; ')}`}</SrOnly>
      </div>
    </div>
  );
}

/** Tabla alternativa de un gráfico de líneas: una fila por instante y una columna por serie. */
export function lineChartTable(series: readonly LineSeries[], opts: I18nProps & { xKind?: 'time' | 'index'; xLabel?: (x: number) => string; yFormat?: (n: number) => string; caption?: string; xHeader?: string } = {}): ChartTable {
  const { lang, t } = resolveT(opts);
  const fmt = opts.yFormat ?? ((n: number) => formatNumber(n, lang, 2));
  const xs = [...new Set(series.flatMap((sr) => sr.points.filter((p) => isFiniteNumber(p.x)).map((p) => p.x)))].sort((a, b) => a - b);
  const xText = (x: number) => ((opts.xKind ?? 'time') === 'time' ? formatInstantMs(x, lang) : (opts.xLabel ? opts.xLabel(x) : formatNumber(x, lang, 0)));
  const lookup = series.map((sr) => new Map(sr.points.filter((p) => isFiniteNumber(p.x)).map((p) => [p.x, p.y] as const)));
  return {
    caption: opts.caption,
    columns: [opts.xHeader ?? t('chart.table.time'), ...series.map((sr) => sr.label)],
    rows: xs.map((x) => [xText(x), ...lookup.map((mp) => { const v = mp.get(x); return isFiniteNumber(v) ? fmt(v) : null; })]),
  };
}
