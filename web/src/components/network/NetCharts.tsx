import { BarChart, barChartTable, ChartCard, Donut, donutTable } from '../../charts';
import type { Lang } from '../../i18n/core';
import type { MsgKey, TFn } from '../../i18n';
import { categoryBars, criticalitySlices, critKey, linksCrossTab } from '../../lib/netview';
import type { NetworkLinkItem, NetworkSummary } from '../../lib/types';

const critLabel = (c: string, t: TFn) => { const k = critKey(c); return k ? t(k as MsgKey) : c; };

/** Los tres gráficos del resumen: criticidad (anillo), categorías (barras horizontales) y enlaces por tipo y criticidad (barras apiladas). */
export function NetCharts({ summary, links, linksError, lang, t }: { summary: NetworkSummary; links: NetworkLinkItem[] | null; linksError: boolean; lang: Lang; t: TFn }) {
  const slices = criticalitySlices(summary).map((x) => ({ id: x.id, label: critLabel(x.criticality, t), value: x.value, tone: x.tone }));
  const by = (c: string) => summary.byCriticality.find((x) => x.criticality === c)?.count ?? 0;
  const total = summary.totals.devices;

  const bars = categoryBars(summary);
  const cats = bars.map((b) => ({ id: b.id, label: b.category ?? t('netview.chart.category.other', { n: b.folded }) }));
  const catSeries = [{ id: 'devices', label: t('netview.chart.category.series'), values: bars.map((b) => b.value) }];

  const cross = links ? linksCrossTab(links, summary.byCriticality.map((c) => c.criticality)) : null;
  const typeCats = (cross?.types ?? []).map((ty) => ({ id: ty, label: ty }));
  const typeSeries = (cross?.series ?? []).map((sr) => ({ id: sr.criticality, label: critLabel(sr.criticality, t), values: sr.values, tone: sr.criticality === 'Crítica' ? ('bad' as const) : sr.criticality === 'Alta' ? ('warn' as const) : ('chart-other' as const) }));
  const topType = cross && cross.types.length ? { name: cross.types[0], count: cross.series.reduce((n, sr) => n + sr.values[0], 0) } : null;

  return (
    <>
      <ChartCard lang={lang} t={t} title={t('netview.chart.criticality.title')} state={slices.some((x) => x.value > 0) ? 'ready' : 'empty'} footnote={t('netview.chart.foot')}
        table={donutTable(slices, { lang, t, caption: t('netview.chart.criticality.title') })}>
        <Donut lang={lang} t={t} slices={slices} centerLabel={t('netview.chart.criticality.center')}
          ariaLabel={t('netview.chart.criticality.aria', { critical: by('Crítica'), high: by('Alta'), medium: by('Media'), total })} />
      </ChartCard>

      <ChartCard lang={lang} t={t} title={t('netview.chart.category.title')} state={bars.length ? 'ready' : 'empty'} footnote={t('netview.chart.foot')}
        table={barChartTable(cats, catSeries, { lang, t, caption: t('netview.chart.category.title'), categoryHeader: t('netview.chart.category.column') })}>
        <BarChart lang={lang} t={t} orientation="horizontal" categories={cats} series={catSeries}
          ariaLabel={bars[0] ? t('netview.chart.category.aria', { top: bars[0].category ?? '', count: bars[0].value, total }) : ''} />
      </ChartCard>

      <ChartCard lang={lang} t={t} title={t('netview.chart.links.title')} state={linksError ? 'error' : links === null ? 'loading' : cross && cross.types.length ? 'ready' : 'empty'} stateText={linksError ? t('netview.chart.links.error') : undefined}
        footnote={t('netview.chart.foot')} table={cross ? barChartTable(typeCats, typeSeries, { lang, t, caption: t('netview.chart.links.title'), categoryHeader: t('netview.chart.links.column'), stacked: true }) : undefined}>
        <BarChart lang={lang} t={t} orientation="horizontal" stacked categories={typeCats} series={typeSeries}
          ariaLabel={t('netview.chart.links.aria', { total: summary.totals.links, types: typeCats.length, top: topType?.name ?? '', count: topType?.count ?? 0 })} />
      </ChartCard>
    </>
  );
}
