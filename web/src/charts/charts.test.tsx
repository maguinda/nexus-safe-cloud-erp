import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarChart, barChartTable, barPath, ChartCard, Delta, Donut, donutTable, foldSlices, Gauge, gaugeTone, Heatmap, heatmapTable, heatMix, LineChart, lineChartTable, Sparkline } from './index';
import type { LineSeries } from './index';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const clean = (out: string) => { expect(out).not.toMatch(/NaN|undefined|Infinity|\[object/); return out; };
const count = (out: string, re: RegExp) => (out.match(re) ?? []).length;
const T0 = Date.parse('2026-09-13T08:00:00Z');
const pts = (ys: (number | null)[]) => ys.map((y, i) => ({ x: T0 + i * 600_000, y }));
const s1: LineSeries = { id: 'o1', label: 'Oficina 1', points: pts([22, 22.5, 23, 24, 23.5]) };
const s2: LineSeries = { id: 'o2', label: 'Oficina 2', points: pts([21, 21.5, 22, 22.5, 24.5]) };

describe('LineChart', () => {
  it('is an image with a summary, a keyboard hint and the series drawn', () => {
    const out = clean(html(<LineChart lang="es" series={[s1]} ariaLabel="La Oficina 1 sube a 24 °C" />));
    expect(out).toContain('role="img"'); expect(out).toContain('aria-label="La Oficina 1 sube a 24 °C"'); expect(out).toContain('tabindex="0"');
    expect(out).toContain('Usa las flechas'); expect(count(out, /<path[^>]*class="[^"]*line/g)).toBe(1);
  });
  it('shows a legend with two or more series and none with one (the title already says what it is)', () => {
    expect(html(<LineChart series={[s1]} ariaLabel="x" />)).not.toContain('Leyenda');
    const out = html(<LineChart series={[s1, s2]} ariaLabel="x" />);
    expect(out).toContain('Leyenda'); expect(out).toContain('Oficina 1'); expect(out).toContain('Oficina 2');
  });
  it('draws the threshold with its label, and the band and the events', () => {
    const out = clean(html(<LineChart series={[s1]} thresholds={[{ y: 24, label: 'Umbral 24 °C' }]} band={{ label: 'Mín–máx', points: s1.points.map((p) => ({ x: p.x, lower: (p.y as number) - 1, upper: (p.y as number) + 1 })) }} markers={[{ x: T0 + 3 * 600_000, y: 24, label: 'Advertencia' }]} ariaLabel="x" />));
    expect(out).toContain('Umbral 24 °C'); expect(out).toContain('Mín–máx'); expect(out).toContain('Advertencia'); expect(out).toMatch(/rotate\(45/);
  });
  it('the threshold stays inside the axis even if all data is below it', () => {
    const out = clean(html(<LineChart series={[{ id: 'a', label: 'A', points: pts([10, 11]) }]} thresholds={[{ y: 50, label: 'Tope' }]} ariaLabel="x" />));
    expect(out).toContain('Tope'); expect(out).toMatch(/>50</);
  });
  it('labels the end of each line directly when there are up to 4 and they fit', () => { expect(clean(html(<LineChart series={[s1, s2]} ariaLabel="x" />))).toMatch(/<text[^>]*>Oficina 2<\/text>/); });
  it('weird input never prints NaN or undefined: one point, all equal, huge, negatives, NaN, Infinity, gaps', () => {
    const cases: LineSeries[][] = [
      [{ id: 'a', label: 'A', points: pts([5]) }],
      [{ id: 'a', label: 'A', points: pts([7, 7, 7, 7]) }],
      [{ id: 'a', label: 'A', points: pts([1e15, 2e15, 1.5e15]) }],
      [{ id: 'a', label: 'A', points: pts([-5, -1, -3]) }],
      [{ id: 'a', label: 'A', points: [{ x: T0, y: NaN }, { x: T0 + 1, y: Infinity }, { x: NaN, y: 3 }, { x: T0 + 2, y: 4 }] }],
      [{ id: 'a', label: 'A', points: pts([1, null, 3, null, null, 6]) }],
      [{ id: 'a', label: 'A', points: pts([0, 0, 0]) }],
    ];
    for (const c of cases) clean(html(<LineChart series={c} ariaLabel="x" />));
  });
  it('with nothing to draw it still renders an image with its label (no crash, no NaN)', () => {
    for (const c of [[], [{ id: 'a', label: 'A', points: [] }], [{ id: 'a', label: 'A', points: pts([null, null]) }]] as LineSeries[][]) { const out = clean(html(<LineChart series={c} ariaLabel="sin datos" />)); expect(out).toContain('aria-label="sin datos"'); }
  });
  it('category axes (xKind index) use the label function', () => { expect(clean(html(<LineChart xKind="index" xLabel={(x) => `Día ${x + 1}`} series={[{ id: 'a', label: 'A', points: [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }] }]} ariaLabel="x" />))).toContain('Día 1'); });
  it('lineChartTable has one row per instant and one column per series, with the same values', () => {
    const tb = lineChartTable([s1, s2], { lang: 'en' });
    expect(tb.rows).toHaveLength(5); expect(tb.columns).toEqual(['Time', 'Oficina 1', 'Oficina 2']); expect(tb.rows[0]).toEqual(['13 Sep 2026, 08:00 UTC', '22', '21']); expect(tb.rows[4][2]).toBe('24.5');
  });
  it('lineChartTable leaves a hole for a missing value and unions the instants', () => {
    const tb = lineChartTable([{ id: 'a', label: 'A', points: pts([1, 2]) }, { id: 'b', label: 'B', points: [{ x: T0 + 600_000, y: 9 }, { x: T0 + 1_200_000, y: 8 }] }]);
    expect(tb.rows).toHaveLength(3); expect(tb.rows[0][2]).toBeNull(); expect(tb.rows[2][1]).toBeNull();
  });
});

describe('BarChart', () => {
  const cats = [{ id: 'a', label: 'Laptop' }, { id: 'b', label: 'PC' }, { id: 'c', label: 'Router' }];
  const one = [{ id: 'n', label: 'Equipos', values: [36, 11, 2] }];
  it('vertical: image + label, one bar per value, values at the tips, zero in the axis', () => {
    const out = clean(html(<BarChart lang="es" categories={cats} series={one} ariaLabel="Equipos por categoría" />));
    expect(out).toContain('role="img"'); expect(out).toContain('aria-label="Equipos por categoría"'); expect(count(out, /<path[^>]*class="[^"]*mark/g)).toBe(3);
    for (const v of ['36', '11', '2']) expect(out).toContain(`>${v}<`);
    expect(out).toContain('>0<');
  });
  it('horizontal: category labels on the left and the same number of bars', () => {
    const out = clean(html(<BarChart orientation="horizontal" categories={cats} series={one} ariaLabel="x" />));
    expect(out).toContain('Laptop'); expect(count(out, /<path[^>]*class="[^"]*mark/g)).toBe(3);
  });
  it('grouped (two series) has a legend and 2 × categories bars; stacked also shows the total', () => {
    const two = [...one, { id: 'm', label: 'Críticos', values: [5, 4, 1] }];
    const g = clean(html(<BarChart categories={cats} series={two} ariaLabel="x" />));
    expect(g).toContain('Leyenda'); expect(count(g, /<path[^>]*class="[^"]*mark/g)).toBe(6);
    const st = clean(html(<BarChart stacked categories={cats} series={two} ariaLabel="x" />));
    expect(st).toContain('>41<'); // 36 + 5
  });
  it('a zero draws no bar (its length is zero) and a null is a missing one', () => { expect(count(clean(html(<BarChart categories={cats} series={[{ id: 'n', label: 'N', values: [3, 0, 5] }]} ariaLabel="x" />)), /<path[^>]*class="[^"]*mark/g)).toBe(2); });
  it('a null is a missing bar, not a zero-length one', () => { expect(count(clean(html(<BarChart categories={cats} series={[{ id: 'n', label: 'N', values: [3, null, 5] }]} ariaLabel="x" />)), /<path[^>]*class="[^"]*mark/g)).toBe(2); });
  it('weird input never prints NaN: all zero, negatives, huge, one category, NaN/Infinity, many categories', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, label: `Categoría número ${i}` }));
    clean(html(<BarChart categories={cats} series={[{ id: 'z', label: 'Z', values: [0, 0, 0] }]} ariaLabel="x" />));
    clean(html(<BarChart categories={cats} series={[{ id: 'z', label: 'Z', values: [-4, 6, -1] }]} ariaLabel="x" />));
    clean(html(<BarChart categories={cats} series={[{ id: 'z', label: 'Z', values: [1e15, 3, 2] }]} ariaLabel="x" />));
    clean(html(<BarChart categories={[cats[0]]} series={[{ id: 'z', label: 'Z', values: [7] }]} ariaLabel="x" />));
    clean(html(<BarChart categories={cats} series={[{ id: 'z', label: 'Z', values: [NaN, Infinity, 2] }]} ariaLabel="x" />));
    clean(html(<BarChart categories={many} series={[{ id: 'z', label: 'Z', values: many.map((_, i) => i) }]} ariaLabel="x" />));
    clean(html(<BarChart orientation="horizontal" categories={many} series={[{ id: 'z', label: 'Z', values: many.map((_, i) => i * 3) }]} ariaLabel="x" />));
  });
  it('with many bars the value labels are left to the tooltip and the table, so they never pile up', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, label: `${i}` }));
    expect(count(html(<BarChart categories={many} series={[{ id: 'z', label: 'Z', values: many.map((_, i) => i + 1) }]} ariaLabel="x" />), /class="[^"]*valueText/g)).toBe(0);
  });
  it('an empty chart is still an image with its label', () => { expect(clean(html(<BarChart categories={[]} series={[]} ariaLabel="vacío" />))).toContain('aria-label="vacío"'); });
  it('barChartTable: one row per category, one column per series, and the total when stacked', () => {
    const two = [...one, { id: 'm', label: 'Críticos', values: [5, 0, 1] }];
    const tb = barChartTable(cats, two, { lang: 'en', stacked: true });
    expect(tb.rows).toHaveLength(3); expect(tb.columns).toEqual(['Category', 'Equipos', 'Críticos', 'Total']); expect(tb.rows[0]).toEqual(['Laptop', '36', '5', '41']);
  });
  it('barPath: closed shape, rounded only at the data end, nothing for an empty bar', () => {
    for (const dir of ['up', 'down', 'right', 'left'] as const) { const d = barPath(10, 10, 20, 40, dir); expect(d).toMatch(/^M.*Z$/); expect(d).toContain('Q'); expect(d).not.toMatch(/NaN/); }
    expect(barPath(10, 10, 20, 0, 'up')).toBe(''); expect(barPath(10, 10, NaN, 5, 'up')).toBe(''); expect((barPath(0, 0, 3, 40, 'up').match(/Q/g) ?? []).length).toBe(2);
    expect(barPath(0, 0, 40, 2, 'right')).toMatch(/Q/); // una barra más baja que el radio sigue siendo una forma válida
  });
});

describe('Donut', () => {
  const sl = [{ id: 'c', label: 'Crítica', value: 5 }, { id: 'a', label: 'Alta', value: 5 }, { id: 'm', label: 'Media', value: 66 }];
  it('is an image with the total in the centre and a legend with value and percentage', () => {
    const out = clean(html(<Donut lang="es" slices={sl} ariaLabel="Equipos por criticidad" />));
    expect(out).toContain('aria-label="Equipos por criticidad"'); expect(out).toContain('>76<'); expect(out).toContain('Total'); expect(out).toContain('Leyenda');
    expect(out).toContain('66 · 87 %'); expect(count(out, /<path/g)).toBe(3);
  });
  it('foldSlices keeps 5 and folds the rest into «Otros» (no 7th colour)', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, value: 9 - i }));
    const f = foldSlices(many, 'Otros'); expect(f).toHaveLength(6); expect(f[5]).toMatchObject({ label: 'Otros', value: 4 + 3 + 2 + 1 }); expect(f.map((x) => x.value)).toEqual([9, 8, 7, 6, 5, 10]);
    expect(foldSlices(many.slice(0, 6), 'Otros')).toHaveLength(6);
  });
  it('ignores zero, negative and non-finite values; an empty donut does not crash', () => {
    expect(foldSlices([{ id: 'a', label: 'A', value: 0 }, { id: 'b', label: 'B', value: -3 }, { id: 'c', label: 'C', value: NaN }, { id: 'd', label: 'D', value: 2 }], 'Otros')).toHaveLength(1);
    clean(html(<Donut slices={[]} ariaLabel="x" />)); clean(html(<Donut slices={[{ id: 'a', label: 'A', value: 0 }]} ariaLabel="x" />));
    clean(html(<Donut slices={[{ id: 'a', label: 'A', value: 5 }]} ariaLabel="x" />)); // una sola porción: anillo completo
  });
  it('donutTable: category, value and share', () => { const tb = donutTable(sl, { lang: 'en' }); expect(tb.columns).toEqual(['Category', 'Value', 'Share']); expect(tb.rows).toHaveLength(3); expect(tb.rows[0]).toEqual(['Media', '66', '86.8%']); });
});

describe('Gauge', () => {
  const bands = [{ from: 0, tone: 'bad' as const }, { from: 60, tone: 'warn' as const }, { from: 85, tone: 'ok' as const }];
  it('gaugeTone picks the band of the value (edges belong to the upper band; below the first counts as the first)', () => {
    expect([gaugeTone(10, bands), gaugeTone(60, bands), gaugeTone(84.9, bands), gaugeTone(85, bands), gaugeTone(100, bands), gaugeTone(-5, bands)]).toEqual(['bad', 'warn', 'warn', 'ok', 'ok', 'bad']);
    expect(gaugeTone(3, [{ from: 85, tone: 'ok' }, { from: 0, tone: 'bad' }])).toBe('bad'); // no depende del orden en que vengan
  });
  it('says the state with an icon AND a word, not only a colour', () => {
    const out = clean(html(<Gauge lang="es" value={72} bands={bands} label="Disponibilidad" valueText="72 %" ariaLabel="La disponibilidad es 72 %" />));
    expect(out).toContain('Atención'); expect(out).toContain('>!<'); expect(out).toContain('72 %'); expect(out).toContain('aria-label="La disponibilidad es 72 %"');
  });
  it('clamps values out of range and survives NaN, with and without bands', () => {
    clean(html(<Gauge value={250} label="x" ariaLabel="x" bands={bands} />)); clean(html(<Gauge value={-40} label="x" ariaLabel="x" />)); clean(html(<Gauge value={NaN} label="x" ariaLabel="x" bands={bands} />)); clean(html(<Gauge value={5} min={5} max={5} label="x" ariaLabel="x" />));
  });
});

describe('Heatmap', () => {
  const rows = [{ id: 'r1', label: 'Oficina 1' }, { id: 'r2', label: 'Oficina 2' }];
  const cols = ['08', '09', '10', '11'].map((h) => ({ id: h, label: `${h}:00` }));
  const vals = [[0, 2, 5, 1], [3, null, 0, 9]];
  it('is an image with one cell per row × column, empty cells marked, numbers inside when they fit', () => {
    const out = clean(html(<Heatmap lang="es" rows={rows} cols={cols} values={vals} ariaLabel="Eventos por oficina y hora" />));
    expect(out).toContain('aria-label="Eventos por oficina y hora"'); expect(count(out, /<rect/g)).toBe(8); expect(out).toContain('sin dato'); expect(out).toContain('>9<'); expect(out).toContain('color-mix');
  });
  it('the value is in the cell title too, so colour is never the only channel', () => { expect(html(<Heatmap rows={rows} cols={cols} values={vals} ariaLabel="x" />)).toContain('Oficina 1 · 10:00: 5'); });
  it('weird input never prints NaN: equal values, all zero, negatives, NaN, ragged rows', () => {
    clean(html(<Heatmap rows={rows} cols={cols} values={[[3, 3, 3, 3], [3, 3, 3, 3]]} ariaLabel="x" />)); clean(html(<Heatmap rows={rows} cols={cols} values={[[0, 0, 0, 0], [0, 0, 0, 0]]} ariaLabel="x" />));
    clean(html(<Heatmap rows={rows} cols={cols} values={[[-5, 2, NaN, 1], [3]]} ariaLabel="x" />));
  });
  it('empty or without any value is still an image with its label', () => { for (const [r, c, v] of [[[], cols, []], [rows, [], [[], []]], [rows, cols, [[null, null, null, null], [null, null, null, null]]]] as const) expect(clean(html(<Heatmap rows={r} cols={c} values={v} ariaLabel="vacío" />))).toContain('aria-label="vacío"'); });
  it('heatMix grows with the value and stays between 10 % and 92 %', () => { expect(heatMix(0)).toBe(10); expect(heatMix(1)).toBe(92); expect(heatMix(2)).toBe(92); expect(heatMix(-1)).toBe(10); expect(heatMix(0.5)).toBeGreaterThan(heatMix(0.4)); });
  it('heatmapTable: one row per row and one column per column', () => { const tb = heatmapTable(rows, cols, vals, { lang: 'en' }); expect(tb.rows).toHaveLength(2); expect(tb.columns).toHaveLength(5); expect(tb.rows[1][2]).toBeNull(); expect(tb.rows[1][4]).toBe('9'); });
});

describe('Delta', () => {
  const cls = (out: string) => (out.match(/deltaGood|deltaBad|deltaNeutral/) ?? [''])[0];
  it('a rise that is good, a rise that is bad (temperature) and a fall that is good', () => {
    expect(cls(html(<Delta previous={100} current={112.5} goodWhen="up" lang="es" />))).toBe('deltaGood');
    expect(cls(html(<Delta previous={22} current={24} goodWhen="down" />))).toBe('deltaBad');
    expect(cls(html(<Delta previous={10} current={5} goodWhen="down" />))).toBe('deltaGood');
  });
  it('says the direction with an icon and words, and writes the percentage in the language', () => {
    const out = html(<Delta previous={100} current={112.5} lang="es" showVs />);
    expect(out).toContain('▲'); expect(out).toContain('12,5 %'); expect(out).toContain('aria-label="Sube 12,5 % frente al periodo anterior"');
    expect(html(<Delta previous={100} current={90} lang="en" />)).toContain('aria-label="Down 10%"');
  });
  it('neutral meaning has no good or bad colour; no change and no comparison are neutral too', () => {
    expect(cls(html(<Delta previous={1} current={5} goodWhen="neutral" />))).toBe('deltaNeutral');
    expect(cls(html(<Delta previous={100} current={100} />))).toBe('deltaNeutral'); expect(html(<Delta previous={100} current={100} lang="en" />)).toContain('No change');
    for (const [p, c] of [[0, 5], [null, 5], [5, NaN]] as const) { const out = clean(html(<Delta previous={p} current={c} lang="en" />)); expect(out).toContain('No comparison'); expect(cls(out)).toBe('deltaNeutral'); }
  });
  it('accepts a percentage that was already calculated', () => { expect(html(<Delta pct={-3.2} goodWhen="up" lang="en" />)).toContain('▼'); expect(cls(html(<Delta pct={-3.2} goodWhen="up" />))).toBe('deltaBad'); });
});

describe('Sparkline', () => {
  it('draws a line and an end dot and carries its summary', () => { const out = clean(html(<Sparkline values={[1, 3, 2, 5]} ariaLabel="De 1 a 5" />)); expect(out).toContain('aria-label="De 1 a 5"'); expect(out).toContain('<circle'); });
  it('survives one value, equal values, gaps and nothing', () => { for (const v of [[4], [2, 2, 2], [1, null, 3], [], [NaN, Infinity]]) clean(html(<Sparkline values={v} ariaLabel="x" />)); });
});

describe('ChartCard', () => {
  const table = { columns: ['Categoría', 'Valor'], rows: [['A', '1'], ['B', '2'], ['C', null]] };
  it('has a title, the chart and a «Ver como tabla» with ALL the rows', () => {
    const out = clean(html(<ChartCard lang="es" title="Equipos" subtitle="Por categoría" table={table}><p>grafico</p></ChartCard>));
    expect(out).toContain('Equipos'); expect(out).toContain('Por categoría'); expect(out).toContain('grafico'); expect(out).toContain('Ver como tabla'); expect(out).toContain('<details');
    expect(count(out, /<tr>/g)).toBe(4); expect(out).toContain('—');
  });
  it('states: empty says «Sin datos» (and does not draw the chart or the table), loading is a status, error says so', () => {
    const e = html(<ChartCard lang="es" title="T" state="empty" table={table}><p>grafico</p></ChartCard>); expect(e).toContain('Sin datos'); expect(e).not.toContain('grafico'); expect(e).not.toContain('Ver como tabla');
    expect(html(<ChartCard lang="en" title="T" state="empty"><p>g</p></ChartCard>)).toContain('No data');
    expect(html(<ChartCard lang="es" title="T" state="loading" />)).toContain('role="status"');
    expect(html(<ChartCard lang="es" title="T" state="error" />)).toContain('No se pudo mostrar el gráfico');
    expect(html(<ChartCard title="T" state="empty" stateText="Todavía no hay lecturas" />)).toContain('Todavía no hay lecturas');
  });
  it('no table button when there are no rows, the heading level is configurable, and labels come in as text (no HTML injection)', () => {
    expect(html(<ChartCard title="T" table={{ columns: ['a'], rows: [] }}><p>x</p></ChartCard>)).not.toContain('Ver como tabla');
    expect(html(<ChartCard title="T" headingLevel={2}><p>x</p></ChartCard>)).toMatch(/<h2/);
    const bad = '<img src=x onerror=alert(1)>';
    const out = html(<ChartCard title={bad} table={{ columns: [bad], rows: [[bad, bad]] }}><LineChart series={[{ id: bad, label: bad, points: pts([1, 2]) }, { id: 'b', label: 'B', points: pts([2, 3]) }]} ariaLabel={bad} /></ChartCard>);
    expect(out).not.toContain('<img'); expect(out).toContain('&lt;img');
  });
});

describe('charts.css (the colours)', () => {
  const css = readFileSync(join(__dirname, '..', 'styles', 'charts.css'), 'utf8');
  // El bloque de un selector, buscado al inicio de línea (el comentario del encabezado también nombra los selectores).
  const block = (selector: string) => { const m = new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm').exec(css); expect(m, selector).not.toBeNull(); const i = (m as RegExpExecArray).index; return css.slice(i, css.indexOf('}', i)); };
  const hexes = (b: string) => [1, 2, 3, 4, 5, 6].map((n) => (b.match(new RegExp(`--chart-${n}:\\s*(#[0-9a-fA-F]{6})`)) ?? [])[1]);
  // Se calculan dentro de cada prueba: si falta un selector falla ESA prueba, no la carga de todo el archivo.
  const pal = () => ({ light: hexes(block(':root')), darkSys: hexes(block(':root:not([data-theme="light"])')), darkSel: hexes(block(':root[data-theme="dark"]')) });
  it('the light palette has 6 different colours', () => { const { light } = pal(); expect(light.every(Boolean)).toBe(true); expect(new Set(light).size).toBe(6); });
  it('the dark palette has 6 different colours, set for BOTH selectors (the person’s choice and the system) and identical in each', () => {
    const { darkSel, darkSys } = pal();
    expect(darkSel.every(Boolean)).toBe(true); expect(new Set(darkSel).size).toBe(6); expect(darkSys).toEqual(darkSel);
    expect(css).toContain('@media (prefers-color-scheme: dark)'); expect(css).toContain(':root:not([data-theme="light"])'); expect(css).toContain(':root[data-theme="dark"]');
  });
  it('dark steps differ from the light ones (they are re-stepped for the dark surface, not copied), except the green that already worked in both', () => { const { light, darkSel } = pal(); expect(darkSel.filter((c, i) => c === light[i]).length).toBeLessThanOrEqual(1); });
  it('defines the other tokens the charts use', () => { for (const t of ['--chart-other', '--chart-grid', '--chart-axis', '--chart-threshold', '--chart-band', '--chart-seq', '--chart-on-seq']) expect(css, t).toContain(`${t}:`); expect(block(':root[data-theme="dark"]')).toContain('--chart-seq'); });
  it('no component paints with a fixed colour: only var(--…) tokens', () => {
    for (const f of ['BarChart', 'LineChart', 'Donut', 'Gauge', 'Heatmap', 'Sparkline', 'parts', 'ChartCard', 'Delta']) { const src = readFileSync(join(__dirname, `${f}.tsx`), 'utf8'); expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(/); }
    expect(readFileSync(join(__dirname, 'charts.module.css'), 'utf8').replace(/rgba\(0, 0, 0, 0\.16\)/, '')).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(/);
  });
  it('respects reduced motion', () => { expect(readFileSync(join(__dirname, 'charts.module.css'), 'utf8')).toContain('prefers-reduced-motion'); });
});
