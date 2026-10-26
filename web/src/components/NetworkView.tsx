import { useState } from 'react';
import { formatNumber } from '../charts';
import { useGoExplorer } from '../hooks/useGoExplorer';
import { useNetworkData } from '../hooks/useNetworkData';
import { errorText } from '../i18n/server';
import { applyInsight, coverageRows, initialExplorer, linksOfDevice, applyAction, type ExplorerState, type InsightAction } from '../lib/netview';
import type { Insight } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { CoverageGrid } from './network/CoverageGrid';
import { Explorer } from './network/Explorer';
import { InsightCards } from './network/InsightCards';
import { NetCharts } from './network/NetCharts';
import { type KpiTarget, NetKpis } from './network/NetKpis';
import s from './network/network.module.css';

/** Qué filtro aplica cada tarjeta de cifras al pulsar «Ver detalle». */
const KPI_ACTIONS: Record<KpiTarget, InsightAction> = {
  devices: { tab: 'devices' },
  links: { tab: 'links' },
  critical: { tab: 'devices', devices: { criticality: 'Crítica' } },
  infra: { tab: 'devices', devices: { monitored: 'yes' } },
  basics: { tab: 'devices', devices: { monitored: 'yes' } },
};

/**
 * «Red» del gerente: hallazgos (qué atender y por qué), cifras con contexto, gráficos y un explorador con filtros del inventario de Nexus
 * (hoja «Data para Proveedor ERP»). Todo sale del servicio Analytics; los nombres, modelos y categorías son datos y se muestran como están.
 */
export function NetworkView() {
  const { api, t, lang } = useSession();
  const { summary, facets, links, linksError, cause, reload } = useNetworkData(api);
  const [explorer, setExplorer] = useState<ExplorerState>(initialExplorer);
  const { ref: explorerRef, go: goExplorer } = useGoExplorer<ExplorerState>(setExplorer);

  if (!summary) {
    return cause
      ? <div className={ui.panelError} role="alert"><strong>{t('netview.unavailable')}</strong><span>{errorText(cause, t, 'netview.loadError')}</span><button type="button" className={ui.btnGhost} onClick={reload}>{t('netview.retry')}</button></div>
      : <p className={ui.muted} role="status">{t('netview.loading')}</p>;
  }
  if (summary.totals.devices === 0) return <section aria-labelledby="net-h"><h2 id="net-h" className={s.title}>{t('netview.title')}</h2><p className={ui.muted}>{t('netview.empty')}</p></section>;

  const rows = coverageRows(summary);
  return (
    <section aria-labelledby="net-h" className={s.stack}>
      <div className={s.head}>
        <h2 id="net-h" className={s.title}>{t('netview.title')}</h2>
        <p className={s.sub}>{t('netview.subtitle', { devices: formatNumber(summary.totals.devices, lang, 0), links: formatNumber(summary.totals.links, lang, 0), infra: formatNumber(summary.totals.infrastructure, lang, 0) })}</p>
        <p className={s.sub}>{t('netview.source')}</p>
      </div>
      {cause !== null && <p className={s.warn} role="status">{t('netview.stale', { error: errorText(cause, t, 'netview.loadError') })}</p>}

      <InsightCards insights={summary.insights} t={t} onAction={(i: Insight) => goExplorer((x) => applyInsight(x, i))} />
      <NetKpis summary={summary} rows={rows} lang={lang} t={t} onDetail={(target) => goExplorer((x) => applyAction(x, KPI_ACTIONS[target]))} />

      <div className={s.charts}>
        <div className={s.wide}><CoverageGrid rows={rows} lang={lang} t={t} signals={summary.monitoring.signalsPossible} onViewLinks={(name) => goExplorer((x) => linksOfDevice(x, name))} /></div>
        <NetCharts summary={summary} links={links} linksError={linksError} lang={lang} t={t} />
      </div>

      <Explorer ref={explorerRef} api={api} state={explorer} setState={setExplorer} facets={facets} totals={{ devices: summary.totals.devices, links: summary.totals.links }} lang={lang} t={t} />
    </section>
  );
}
