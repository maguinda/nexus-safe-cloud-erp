import { useId } from 'react';
import s from './charts.module.css';
import { formatNumber, formatTick } from './format';
import { Legend, SrOnly, Tooltip, type TooltipRow } from './parts';
import { bandLayout, isFiniteNumber, linearScale, niceDomain, round2 } from './scale';
import { useActive } from './useActive';
import { useChartWidth } from './useChartWidth';
import { resolveT, seriesTone, toneColor, type ChartTable, type I18nProps, type LegendItem, type Tone } from './types';

export interface BarCategory { id: string; label: string; /** Texto corto para el eje si el largo no cabe. */ shortLabel?: string }
export interface BarSeries { id: string; label: string; tone?: Tone; /** Un valor por categoría, en el mismo orden. null = sin dato. */ values: readonly (number | null | undefined)[] }

export interface BarChartProps extends I18nProps {
  categories: readonly BarCategory[];
  series: readonly BarSeries[];
  orientation?: 'vertical' | 'horizontal';
  /** Apilado: los segmentos de una categoría se suman (valores no negativos). Si no, agrupado: uno al lado del otro. */
  stacked?: boolean;
  /** Valor sobre cada barra. Por defecto sí, mientras sean pocas (hasta 14); con más, solo el tooltip y la tabla. */
  showValues?: boolean;
  valueFormat?: (n: number) => string;
  /** Tope fijo del eje de valores (p. ej. 100 para un porcentaje). */
  max?: number;
  ariaLabel: string;
  height?: number;
}

const THICK = 24; // grosor máximo de una barra: nunca llena su banda
const GAP = 2;    // aire entre barras o segmentos que se tocan

/** Barra con el extremo del dato redondeado (4 px) y el de la base recto. `dir` es hacia dónde crece. */
export function barPath(x: number, y: number, w: number, h: number, dir: 'up' | 'down' | 'right' | 'left', radius = 4): string {
  if (!(w > 0) || !(h > 0) || ![x, y, w, h].every(isFiniteNumber)) return '';
  const r = Math.max(0, Math.min(radius, w / 2, h));
  const [X, Y, W, H] = [round2(x), round2(y), round2(w), round2(h)];
  if (dir === 'up') return `M${X} ${round2(Y + H)}V${round2(Y + r)}Q${X} ${Y} ${round2(X + r)} ${Y}H${round2(X + W - r)}Q${round2(X + W)} ${Y} ${round2(X + W)} ${round2(Y + r)}V${round2(Y + H)}Z`;
  if (dir === 'down') return `M${X} ${Y}V${round2(Y + H - r)}Q${X} ${round2(Y + H)} ${round2(X + r)} ${round2(Y + H)}H${round2(X + W - r)}Q${round2(X + W)} ${round2(Y + H)} ${round2(X + W)} ${round2(Y + H - r)}V${Y}Z`;
  if (dir === 'right') return `M${X} ${Y}H${round2(X + W - r)}Q${round2(X + W)} ${Y} ${round2(X + W)} ${round2(Y + r)}V${round2(Y + H - r)}Q${round2(X + W)} ${round2(Y + H)} ${round2(X + W - r)} ${round2(Y + H)}H${X}Z`;
  return `M${round2(X + W)} ${Y}H${round2(X + r)}Q${X} ${Y} ${X} ${round2(Y + r)}V${round2(Y + H - r)}Q${X} ${round2(Y + H)} ${round2(X + r)} ${round2(Y + H)}H${round2(X + W)}Z`;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

/** Barras verticales u horizontales, agrupadas o apiladas, con eje siempre desde cero. */
export function BarChart({ categories, series, orientation = 'vertical', stacked = false, showValues, valueFormat, max, ariaLabel, height, ...i18n }: BarChartProps) {
  const { lang, t } = resolveT(i18n);
  const { ref, width } = useChartWidth();
  const id = useId();
  const n = categories.length;
  const { active, setActive, onKeyDown, clear } = useActive(n);
  const horizontal = orientation === 'horizontal';
  const fmt = valueFormat ?? ((v: number) => formatNumber(v, lang, 1));
  const tones = series.map((sr, i) => sr.tone ?? seriesTone(i));
  const val = (k: number, i: number): number | null => { const v = series[k]?.values[i]; return isFiniteNumber(v) ? v : null; };
  const anyData = n > 0 && series.some((_, k) => categories.some((_c, i) => val(k, i) !== null));
  if (!anyData) return <div ref={ref} className={s.root}><svg className={s.svg} width="100%" height={height ?? 160} role="img" aria-label={ariaLabel} /></div>;

  // Dominio del eje de valores: siempre incluye el cero (la longitud de la barra ES el dato).
  const totals = categories.map((_, i) => { let pos = 0, neg = 0; series.forEach((_s, k) => { const v = val(k, i); if (v === null) return; if (v >= 0) pos += v; else neg += v; }); return { pos, neg }; });
  const extentVals = stacked ? totals.flatMap((tt) => [tt.pos, tt.neg]) : series.flatMap((_s, k) => categories.map((_c, i) => val(k, i)));
  const many = n * (stacked ? 1 : series.length) > 14;
  const labelsOn = showValues ?? !many;
  const rowH = horizontal ? Math.max(28, Math.min(46, THICK * (stacked ? 1 : series.length) + 14)) : 0;
  const H = height ?? (horizontal ? Math.max(120, n * rowH + 40) : 240);
  const dom = niceDomain(extentVals, { includeZero: true, max, count: Math.max(3, Math.round((horizontal ? width - 120 : H) / (horizontal ? 90 : 48))) });
  const tick = (v: number) => formatTick(v, lang);

  const catText = (c: BarCategory) => c.shortLabel ?? c.label;
  const maxCat = Math.max(...categories.map((c) => catText(c).length));
  const m = horizontal
    ? { l: Math.min(width * 0.42, Math.max(54, maxCat * 6.6 + 12)), r: labelsOn ? 52 : 12, t: 8, b: 26 }
    : { l: Math.max(30, Math.max(...dom.ticks.map((v) => tick(v).length)) * 6.6 + 12), r: 8, t: labelsOn ? 20 : 10, b: 28 };
  const plotW = Math.max(40, width - m.l - m.r), plotH = Math.max(40, H - m.t - m.b);

  // Escala del valor y bandas de las categorías.
  const V = horizontal ? linearScale(dom.min, dom.max, m.l, m.l + plotW) : linearScale(dom.min, dom.max, m.t + plotH, m.t);
  const band = bandLayout(n, horizontal ? plotH : plotW, THICK * (stacked ? 1 : series.length) + (stacked ? 0 : GAP * (series.length - 1)), 0.28);
  const barThick = stacked ? Math.min(THICK, band.thickness) : Math.min(THICK, (band.thickness - GAP * (series.length - 1)) / series.length);
  const zero = V(0);

  type Rect = { k: number; i: number; x: number; y: number; w: number; h: number; dir: 'up' | 'down' | 'right' | 'left'; v: number };
  const rects: Rect[] = [];
  categories.forEach((_c, i) => {
    const base = (horizontal ? m.t : m.l) + band.offset(i);
    let posAcc = 0, negAcc = 0;
    series.forEach((_s, k) => {
      const v = val(k, i);
      if (v === null) return;
      let from = 0, to = v;
      if (stacked) { if (v >= 0) { from = posAcc; to = posAcc + v; posAcc = to; } else { from = negAcc; to = negAcc + v; negAcc = to; } }
      const lo = Math.min(V(from), V(to)), hi = Math.max(V(from), V(to));
      const off = stacked ? 0 : k * (barThick + GAP);
      const cross = base + off + (band.thickness - (stacked ? barThick : series.length * barThick + GAP * (series.length - 1))) / 2;
      const gapIn = stacked && (v >= 0 ? from > 0 : from < 0) ? GAP : 0; // 2 px de aire entre segmentos que se tocan
      const dir: Rect['dir'] = horizontal ? (v >= 0 ? 'right' : 'left') : (v >= 0 ? 'up' : 'down');
      if (horizontal) rects.push({ k, i, x: lo + (v >= 0 ? gapIn : 0), y: cross, w: Math.max(0, hi - lo - gapIn), h: barThick, dir, v });
      else rects.push({ k, i, x: cross, y: lo + (v < 0 ? gapIn : 0), w: barThick, h: Math.max(0, hi - lo - gapIn), dir, v });
    });
  });
  // En apilado solo el segmento de más afuera lleva el extremo redondeado; los de adentro quedan rectos.
  const outer = new Set<string>();
  if (stacked) categories.forEach((_c, i) => { for (const sign of [1, -1]) { const ks = series.map((_s, k) => k).filter((k) => { const v = val(k, i); return v !== null && v * sign > 0; }); if (ks.length) outer.add(`${ks[ks.length - 1]}:${i}`); } });

  const ax = active;
  const tipRows: TooltipRow[] = ax === null ? [] : [
    ...series.map((sr, k) => ({ id: sr.id, tone: tones[k], label: sr.label, value: val(k, ax) === null ? '—' : fmt(val(k, ax) as number) })),
    ...(stacked && series.length > 1 ? [{ id: '__total', label: t('chart.donut.total'), value: fmt(totals[ax].pos + totals[ax].neg) }] : []),
  ];
  const centre = (i: number) => (horizontal ? m.t : m.l) + band.offset(i) + band.thickness / 2;
  const legend: LegendItem[] = series.map((sr, k) => ({ id: sr.id, label: sr.label, tone: tones[k], shape: 'box' }));
  // Etiquetas del eje de categorías en vertical: se saltan las que no caben (nunca se superponen).
  const stride = horizontal ? 1 : Math.max(1, Math.ceil((maxCat * 6.4 + 10) / band.step));

  return (
    <div ref={ref} className={s.root}>
      {series.length >= 2 && <Legend items={legend} label={t('chart.legend')} />}
      <div className={series.length >= 2 ? s.plotWithLegend : s.plot}>
        <svg className={s.svg} width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={ariaLabel} aria-describedby={`${id}-hint`} tabIndex={0} onKeyDown={onKeyDown} onBlur={clear} onPointerLeave={clear}>
          {dom.ticks.map((tk) => horizontal ? (
            <g key={tk}>
              <line className={s.gridLine} x1={round2(V(tk))} x2={round2(V(tk))} y1={m.t} y2={m.t + plotH} />
              <text className={s.axisText} x={round2(V(tk))} y={H - 8} textAnchor="middle">{tick(tk)}</text>
            </g>
          ) : (
            <g key={tk}>
              <line className={s.gridLine} x1={m.l} x2={m.l + plotW} y1={round2(V(tk))} y2={round2(V(tk))} />
              <text className={s.axisText} x={m.l - 8} y={round2(V(tk)) + 4} textAnchor="end">{tick(tk)}</text>
            </g>
          ))}
          {horizontal ? <line className={s.axisLine} x1={round2(zero)} x2={round2(zero)} y1={m.t} y2={m.t + plotH} /> : <line className={s.axisLine} x1={m.l} x2={m.l + plotW} y1={round2(zero)} y2={round2(zero)} />}

          {categories.map((c, i) => horizontal ? (
            <text key={c.id} className={s.labelText} x={m.l - 8} y={round2(centre(i)) + 4} textAnchor="end"><title>{c.label}</title>{cut(catText(c), Math.floor((m.l - 12) / 6.4))}</text>
          ) : (i % stride === 0 ? <text key={c.id} className={s.axisText} x={round2(centre(i))} y={H - 8} textAnchor="middle"><title>{c.label}</title>{cut(catText(c), Math.max(3, Math.floor((band.step * stride) / 6.2)))}</text> : null))}

          {rects.map((r) => {
            const rounded = !stacked || outer.has(`${r.k}:${r.i}`);
            const d = rounded ? barPath(r.x, r.y, r.w, r.h, r.dir) : `M${round2(r.x)} ${round2(r.y)}h${round2(r.w)}v${round2(r.h)}h${round2(-r.w)}Z`;
            return d ? <path key={`${r.k}:${r.i}`} d={d} className={`${s.mark} ${ax !== null && ax !== r.i ? s.dim : ''}`} style={{ fill: toneColor(tones[r.k]) }} /> : null;
          })}

          {labelsOn && (stacked
            ? categories.map((c, i) => { const tot = totals[i].pos + totals[i].neg; if (!tot) return null; const end = V(totals[i].pos || totals[i].neg); return horizontal ? <text key={c.id} className={s.valueText} x={round2(end) + 6} y={round2(centre(i)) + 4}>{fmt(tot)}</text> : <text key={c.id} className={s.valueText} x={round2(centre(i))} y={round2(end) - 6} textAnchor="middle">{fmt(tot)}</text>; })
            : rects.map((r) => horizontal
              ? <text key={`v${r.k}:${r.i}`} className={s.valueText} x={round2(r.v >= 0 ? r.x + r.w : r.x) + (r.v >= 0 ? 6 : -6)} y={round2(r.y + r.h / 2) + 4} textAnchor={r.v >= 0 ? 'start' : 'end'}>{fmt(r.v)}</text>
              : <text key={`v${r.k}:${r.i}`} className={s.valueText} x={round2(r.x + r.w / 2)} y={round2(r.v >= 0 ? r.y : r.y + r.h) + (r.v >= 0 ? -6 : 14)} textAnchor="middle">{fmt(r.v)}</text>))}

          {categories.map((c, i) => horizontal
            ? <rect key={`h${c.id}`} className={s.hit} x={0} y={round2(m.t + i * band.step)} width={width} height={round2(band.step)} onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)} />
            : <rect key={`h${c.id}`} className={s.hit} x={round2(m.l + i * band.step)} y={0} width={round2(band.step)} height={H} onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)} />)}
        </svg>
        {ax !== null && !horizontal && <Tooltip x={centre(ax)} width={width} title={categories[ax].label} rows={tipRows} />}
        {ax !== null && horizontal && (
          <div className={s.tipLayer} style={{ top: Math.max(0, centre(ax) - 30) }}>
            <Tooltip x={Math.min(width - 100, Math.max(100, m.l + plotW * 0.5))} width={width} title={categories[ax].label} rows={tipRows} />
          </div>
        )}
        <SrOnly id={`${id}-hint`}>{t('chart.hint')}</SrOnly>
        <SrOnly live>{ax === null ? '' : `${categories[ax].label}: ${tipRows.map((r) => `${r.label} ${r.value}`).join('; ')}`}</SrOnly>
      </div>
    </div>
  );
}

/** Tabla alternativa de las barras: una fila por categoría y una columna por serie (más el total si es apilado). */
export function barChartTable(categories: readonly BarCategory[], series: readonly BarSeries[], opts: I18nProps & { valueFormat?: (n: number) => string; caption?: string; stacked?: boolean; categoryHeader?: string } = {}): ChartTable {
  const { lang, t } = resolveT(opts);
  const fmt = opts.valueFormat ?? ((v: number) => formatNumber(v, lang, 1));
  const withTotal = !!opts.stacked && series.length > 1;
  return {
    caption: opts.caption,
    columns: [opts.categoryHeader ?? t('chart.table.category'), ...series.map((sr) => sr.label), ...(withTotal ? [t('chart.donut.total')] : [])],
    rows: categories.map((c, i) => {
      const vals = series.map((sr) => { const v = sr.values[i]; return isFiniteNumber(v) ? v : null; });
      return [c.label, ...vals.map((v) => (v === null ? null : fmt(v))), ...(withTotal ? [fmt(vals.reduce<number>((a, v) => a + (v ?? 0), 0))] : [])];
    }),
  };
}
