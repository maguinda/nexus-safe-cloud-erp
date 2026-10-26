import { Gauge } from '../../charts';
import type { Lang } from '../../i18n/core';
import type { TFn } from '../../i18n';
import { formatCount } from '../../lib/format';
import { basicsPercent, type CoverageRow, coverageTotals } from '../../lib/netview';
import type { NetworkSummary } from '../../lib/types';
import s from './network.module.css';

export type KpiTarget = 'devices' | 'links' | 'critical' | 'infra' | 'basics';

/** Tarjetas de cifras con contexto y un «Ver detalle» que filtra el explorador. La de monitoreo básico lleva un medidor. */
export function NetKpis({ summary, rows, lang, t, onDetail }: { summary: NetworkSummary; rows: CoverageRow[]; lang: Lang; t: TFn; onDetail: (target: KpiTarget) => void }) {
  const n = (v: number) => formatCount(v, lang);
  const totals = coverageTotals(rows);
  const pct = basicsPercent(totals.basics, totals.equipment);
  const card = (target: KpiTarget, labelKey: Parameters<TFn>[0], value: string, sub: string) => (
    <div className={s.kpiCard}>
      <span className={s.kpiLabel}>{t(labelKey)}</span>
      <strong className={s.kpiValue}>{value}</strong>
      <span className={s.kpiSub}>{sub}</span>
      <button type="button" className={s.detail} aria-label={t('netview.kpi.detailAria', { what: t(labelKey) })} onClick={() => onDetail(target)}>{t('netview.kpi.detail')}</button>
    </div>
  );
  return (
    <div className={s.kpis}>
      {card('devices', 'netview.kpi.devices', n(summary.totals.devices), t('netview.kpi.devicesSub'))}
      {card('links', 'netview.kpi.links', n(summary.totals.links), t('netview.kpi.linksSub', { functional: n(summary.links.functional), noData: n(summary.links.noData) }))}
      {card('critical', 'netview.kpi.critical', n(summary.totals.criticalDevices), t('netview.kpi.criticalSub'))}
      {card('infra', 'netview.kpi.infra', n(summary.totals.infrastructure), t('netview.kpi.infraSub'))}
      <div className={s.kpiCard}>
        <span className={s.kpiLabel}>{t('netview.kpi.basics')}</span>
        <div className={s.kpiGauge}>
          <Gauge
            lang={lang} t={t} value={pct} size={150} valueText={t('netview.kpi.basicsValue', { n: totals.basics, total: totals.equipment })} label={t('netview.kpi.basicsLabel')}
            bands={[{ from: 0, tone: 'bad' }, { from: 50, tone: 'warn' }, { from: 80, tone: 'ok' }]} ariaLabel={t('netview.kpi.basicsAria', { n: totals.basics, total: totals.equipment })}
          />
        </div>
        <button type="button" className={s.detail} aria-label={t('netview.kpi.detailAria', { what: t('netview.kpi.basics') })} onClick={() => onDetail('basics')}>{t('netview.kpi.detail')}</button>
      </div>
    </div>
  );
}
