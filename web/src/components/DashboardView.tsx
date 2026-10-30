import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../i18n/server';
import type { MsgKey } from '../i18n';
import { formatCop, timeAgo } from '../lib/format';
import type { Dashboard } from '../lib/types';
import { useSession } from '../session';
import { KpiCard } from './KpiCard';
import { TelemetryPanel } from './TelemetryPanel';
import ui from '../styles/ui.module.css';
import s from './DashboardView.module.css';

const REFRESH_MS = 5000;
/** Tipo de evento -> etiqueta de la app (se traduce); la frase del evento que guardó analytics es un dato y se muestra tal cual. */
const KIND_KEY: Record<string, MsgKey> = { MilestoneApproved: 'dashboard.kind.MilestoneApproved', InvoiceDrafted: 'dashboard.kind.InvoiceDrafted', InvoiceIssued: 'dashboard.kind.InvoiceIssued', PaymentReceived: 'dashboard.kind.PaymentReceived' };

/** Tablero del gerente: se lee SOLO del servicio Analytics (modelos de lectura armados con eventos) y se actualiza solo. */
export function DashboardView() {
  const { api, t } = useSession();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const d = await api.dashboard();
      if (!alive.current) return;
      setData(d); setError(''); setStale(false);
    } catch (e) {
      if (!alive.current) return;
      // Si ya había datos, se conservan y se avisa; si no, se muestra el error.
      setStale(true);
      setError(errorText(e, t, 'dashboard.loadError'));
    }
  }, [api, t]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  if (!data) {
    return error
      ? <div className={ui.panelError} role="alert"><strong>{t('dashboard.errorTitle')}</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('dashboard.retry')}</button></div>
      : <p className={ui.muted} role="status">{t('dashboard.loading')}</p>;
  }
  const tot = data.totals;
  const f = data.freshness;

  return (
    <section aria-labelledby="dash-h" className={s.stack}>
      <div className={s.head}>
        <h2 id="dash-h" className={ui.h2}>{t('dashboard.title')}</h2>
        <p className={`${s.fresh} ${stale ? s.stale : ''}`}>
          <span className={s.live}><span className={s.liveDot} aria-hidden />{stale ? t('dashboard.notRefreshing') : t('dashboard.live')}</span>
          <span>{t('dashboard.updated', { ago: timeAgo(data.asOf, now, t) })}</span>
          {f.lastEventAt && <span>{t('dashboard.lastEvent', { ago: timeAgo(f.lastEventAt, now, t), ms: f.lastEventLagMs ?? 0 })}</span>}
        </p>
      </div>
      {stale && <p className={s.warn} role="status">{t('dashboard.stale', { error })}</p>}

      <div className={ui.kpis}>
        <KpiCard icon="clock" tone={tot.milestonesPending.count > 0 ? 'warn' : undefined} label={t('dashboard.kpi.pending')} value={tot.milestonesPending.count} sub={t('dashboard.copAmount', { amount: formatCop(tot.milestonesPending.cop) })} />
        <KpiCard icon="check" tone="ok" label={t('dashboard.kpi.approved')} value={tot.milestonesApproved} sub={t('dashboard.copAmount', { amount: formatCop(tot.approvedCop) })} />
        <KpiCard icon="check" tone="ok" label={t('dashboard.kpi.collected')} value={tot.collected.paidInvoices} sub={t('dashboard.copWithIva', { amount: formatCop(tot.collected.totalCop) })} />
        <KpiCard icon="hourglass" tone={tot.waitingForInvoice.count > 0 ? 'warn' : undefined} label={t('dashboard.kpi.waiting')} value={tot.waitingForInvoice.count} sub={t('dashboard.copAmount', { amount: formatCop(tot.waitingForInvoice.cop) })} />
        <KpiCard icon="document" label={t('dashboard.kpi.draft')} value={tot.draft.count} sub={t('dashboard.copWithIva', { amount: formatCop(tot.draft.totalCop) })} />
        <KpiCard icon="hourglass" tone={tot.overdue.count > 0 ? 'bad' : undefined} label={t('dashboard.kpi.overdue')} value={tot.overdue.count} sub={t('dashboard.copWithIva', { amount: formatCop(tot.overdue.totalCop) })} />
        <KpiCard icon="receipt" tone="ok" label={t('dashboard.kpi.issued')} value={tot.issued.count} sub={t('dashboard.copWithIva', { amount: formatCop(tot.issued.totalCop) })} />
      </div>

      <section aria-labelledby="dash-proj-h">
        <h3 id="dash-proj-h" className={ui.h2}>{t('dashboard.byProject')}</h3>
        <div className={ui.scroll}>
          <table className={`${ui.table} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>{t('dashboard.projectsCaption')}</caption>
            <thead><tr><th>{t('dashboard.col.project')}</th><th className={ui.num}>{t('dashboard.col.pending')}</th><th className={ui.num}>{t('dashboard.col.approved')}</th><th className={ui.num}>{t('dashboard.col.waiting')}</th><th className={ui.num}>{t('dashboard.col.draft')}</th><th className={ui.num}>{t('dashboard.col.issued')}</th><th className={ui.num}>{t('dashboard.col.overdue')}</th></tr></thead>
            <tbody>
              {data.projects.length === 0
                ? <tr><td colSpan={7} className={ui.muted}>{t('dashboard.noProjects')}</td></tr>
                : data.projects.map((p) => (
                  <tr key={p.projectName}>
                    <td>{p.projectName}</td>
                    <td className={ui.num} data-label={t('dashboard.col.pending')}>{p.milestonesPending}</td>
                    <td className={ui.num} data-label={t('dashboard.col.approved')}>{p.milestonesApproved} · {formatCop(p.approvedCop)}</td>
                    <td className={ui.num} data-label={t('dashboard.col.waiting')}>{p.waitingForInvoice}</td>
                    <td className={ui.num} data-label={t('dashboard.col.draft')}>{formatCop(p.draftTotalCop)}</td>
                    <td className={ui.num} data-label={t('dashboard.col.issued')}>{formatCop(p.issuedTotalCop)}</td>
                    <td className={ui.num} data-label={t('dashboard.col.overdue')}>{p.overdueInvoices}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={ui.card} aria-labelledby="dash-act-h">
        <h3 id="dash-act-h" className={ui.h2}>{t('dashboard.activity')}</h3>
        {data.recentActivity.length === 0
          ? <p className={ui.muted}>{t('dashboard.noActivity')}</p>
          : (
            <ol className={s.activity}>
              {data.recentActivity.map((a, i) => (
                <li key={`${a.at}-${i}`}>
                  <span className={s.when}>{timeAgo(a.at, now, t)} · {KIND_KEY[a.kind] ? t(KIND_KEY[a.kind]) : a.kind}</span>
                  <span className={s.msg}>{a.message}</span>
                </li>
              ))}
            </ol>
          )}
      </section>

      <TelemetryPanel />

      <p className={s.note}>{t('dashboard.note')}</p>
    </section>
  );
}
