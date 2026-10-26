import { useCallback, useEffect, useRef, useState } from 'react';
import { formatNumber } from '../charts';
import { errorText } from '../i18n/server';
import { applyInsight, coverageRows, initialExplorer, linksOfDevice, applyAction, type ExplorerState, type InsightAction } from '../lib/netview';
import type { Insight, NetworkFacets, NetworkLinkItem, NetworkSummary } from '../lib/types';
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
  const [summary, setSummary] = useState<NetworkSummary | null>(null);
  const [facets, setFacets] = useState<NetworkFacets | null>(null);
  const [links, setLinks] = useState<NetworkLinkItem[] | null>(null);
  const [linksError, setLinksError] = useState(false);
  const [cause, setCause] = useState<unknown>(null);
  const [explorer, setExplorer] = useState<ExplorerState>(initialExplorer);
  const explorerRef = useRef<HTMLElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const [sm, fc] = await Promise.all([api.networkSummary(), api.networkFacets()]);
      if (!alive.current) return;
      setSummary(sm); setFacets(fc); setCause(null);
    } catch (e) { if (alive.current) setCause(e); }
    // Los enlaces (74) solo alimentan el gráfico de tipo × criticidad: si fallan, falla ese gráfico y no la pantalla.
    api.networkLinks({ limit: 200 }).then((p) => { if (alive.current) { setLinks(p.items); setLinksError(false); } }, () => { if (alive.current) setLinksError(true); });
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  /** Aplica un filtro al explorador y lleva allí el foco y la vista (sin animar si la persona pidió menos movimiento). */
  const goExplorer = useCallback((f: (s: ExplorerState) => ExplorerState) => {
    setExplorer(f);
    requestAnimationFrame(() => {
      const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      explorerRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      explorerRef.current?.focus({ preventScroll: true });
    });
  }, []);

  if (!summary) {
    return cause
      ? <div className={ui.panelError} role="alert"><strong>{t('netview.unavailable')}</strong><span>{errorText(cause, t, 'netview.loadError')}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('netview.retry')}</button></div>
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
