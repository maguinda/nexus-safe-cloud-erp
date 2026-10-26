import { useMemo, type FC } from 'react';
import { BarChart, barChartTable, ChartCard, Donut, donutTable, Heatmap, heatmapTable, LineChart, lineChartTable } from '../../charts';
import { formatNumber } from '../../charts/format';
import type { TFn } from '../../i18n';
import type { Lang } from '../../i18n/core';
import { lineSeries, motionHeat, severitySlices, slotBars, warningMarkers } from '../../lib/sensors';
import type { TelemetryFacets, Trends } from '../../lib/types';
import ui from '../../styles/ui.module.css';
import s from './Sensors.module.css';

const finiteValues = (series: { points: readonly { y: number | null | undefined }[] }[]) => series.flatMap((x) => x.points.map((p) => p.y)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** Los cinco gráficos. Elegir una oficina en los filtros deja solo sus series; cada uno lleva su resumen para el lector de pantalla y su tabla. */
export const Charts: FC<{ trends: Trends; facets: TelemetryFacets; location: string; lang: Lang; t: TFn }> = ({ trends, facets, location, lang, t }) => {
  const n0 = (n: number) => formatNumber(n, lang, 0);
  const n1 = (n: number) => formatNumber(n, lang, 1);
  const d = useMemo(() => {
    const temp = lineSeries(trends, 'avgTempC', location);
    const hum = lineSeries(trends, 'avgHumidityPct', location);
    const markers = warningMarkers(trends, location, (e) => t('sensors.charts.warningMarker', { device: e.deviceName, location: e.location }));
    const bars = slotBars(trends, location, { warnings: t('sensors.severity.warning'), alerts: t('sensors.severity.alert') });
    const heat = motionHeat(trends, location);
    const slices = severitySlices(facets, { normal: t('sensors.severity.normal'), warning: t('sensors.severity.warning'), alert: t('sensors.severity.alert') });
    return { temp, hum, markers, bars, heat, slices };
  }, [trends, facets, location, t]);

  const tempYs = finiteValues(d.temp), humYs = finiteValues(d.hum);
  const threshold = trends.thresholds.tempWarningC;
  const tempFmt = (n: number) => `${n1(n)} °C`, humFmt = (n: number) => `${n1(n)} %`;
  const motionTotal = d.heat.values.flat().reduce<number>((n, v) => n + (v ?? 0), 0);
  const motionMax = Math.max(0, ...d.heat.values.flat().map((v) => v ?? 0));
  const sevN = (id: string) => d.slices.find((x) => x.id === id)?.value ?? 0;
  const foot = t('sensors.charts.footnote');
  const i18n = { lang, t };

  return (
    <section aria-labelledby="sensors-charts-h" className={s.section}>
      <h2 id="sensors-charts-h" className={ui.h2}>{t('sensors.charts.title')}</h2>
      <div className={s.chartsGrid}>
        <div className={s.chartFull}>
          <ChartCard {...i18n} title={t('sensors.charts.temp.title')} subtitle={t('sensors.charts.temp.sub')} state={tempYs.length ? 'ready' : 'empty'} footnote={foot}
            table={lineChartTable(d.temp, { ...i18n, yFormat: tempFmt, caption: t('sensors.charts.temp.title') })}>
            <LineChart {...i18n} series={d.temp} markers={d.markers} thresholds={threshold === null ? [] : [{ y: threshold, label: t('sensors.charts.threshold', { n: n1(threshold) }) }]} yFormat={tempFmt} yDomain={{ includeZero: false }}
              ariaLabel={threshold === null ? t('sensors.charts.temp.ariaNoThreshold') : t('sensors.charts.temp.aria', { threshold: n1(threshold), n: d.markers.length })} height={300} />
          </ChartCard>
        </div>
        <div className={s.chartHalf}>
          <ChartCard {...i18n} title={t('sensors.charts.humidity.title')} subtitle={t('sensors.charts.humidity.sub')} state={humYs.length ? 'ready' : 'empty'}
            table={lineChartTable(d.hum, { ...i18n, yFormat: humFmt, caption: t('sensors.charts.humidity.title') })}>
            <LineChart {...i18n} series={d.hum} yFormat={humFmt} yDomain={{ includeZero: false }}
              ariaLabel={t('sensors.charts.humidity.aria', { min: n1(Math.min(...humYs)), max: n1(Math.max(...humYs)) })} />
          </ChartCard>
        </div>
        <div className={s.chartHalf}>
          <ChartCard {...i18n} title={t('sensors.charts.slots.title')} subtitle={t('sensors.charts.slots.sub')} state={d.bars.categories.length ? 'ready' : 'empty'}
            table={barChartTable(d.bars.categories, d.bars.series, { ...i18n, stacked: true, valueFormat: n0, categoryHeader: t('sensors.charts.slots.header'), caption: t('sensors.charts.slots.title') })}>
            <BarChart {...i18n} categories={d.bars.categories} series={d.bars.series} stacked valueFormat={n0}
              ariaLabel={t('sensors.charts.slots.aria', { w: n0(d.bars.total.warnings), a: n0(d.bars.total.alerts), n: d.bars.categories.length })} />
          </ChartCard>
        </div>
        <div className={s.chartHalf}>
          <ChartCard {...i18n} title={t('sensors.charts.motion.title')} subtitle={t('sensors.charts.motion.sub')} state={d.heat.rows.length && d.heat.cols.length ? 'ready' : 'empty'}
            table={heatmapTable(d.heat.rows, d.heat.cols, d.heat.values, { ...i18n, valueFormat: n0, rowHeader: t('sensors.charts.motion.row'), caption: t('sensors.charts.motion.title') })}>
            <Heatmap {...i18n} rows={d.heat.rows} cols={d.heat.cols} values={d.heat.values} valueFormat={n0} colEvery={3}
              ariaLabel={t('sensors.charts.motion.aria', { n: n0(motionTotal), max: n0(motionMax) })} />
          </ChartCard>
        </div>
        <div className={s.chartHalf}>
          <ChartCard {...i18n} title={t('sensors.charts.severity.title')} subtitle={t('sensors.charts.severity.sub')} state={d.slices.length ? 'ready' : 'empty'}
            table={donutTable(d.slices, { ...i18n, valueFormat: n0, caption: t('sensors.charts.severity.title') })}>
            <Donut {...i18n} slices={d.slices} valueFormat={n0} centerLabel={t('sensors.charts.severity.center')}
              ariaLabel={t('sensors.charts.severity.aria', { normal: n0(sevN('normal')), warning: n0(sevN('warning')), alert: n0(sevN('alert')) })} />
          </ChartCard>
        </div>
      </div>
    </section>
  );
};
