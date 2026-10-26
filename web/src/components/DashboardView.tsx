import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { formatCop, timeAgo } from '../lib/format';
import type { Dashboard } from '../lib/types';
import { useSession } from '../session';
import { TelemetryPanel } from './TelemetryPanel';
import ui from '../styles/ui.module.css';
import s from './DashboardView.module.css';

const REFRESH_MS = 5000;
const KIND_LABEL: Record<string, string> = { MilestoneApproved: 'Approved', InvoiceDrafted: 'Draft', InvoiceIssued: 'Issued' };

/** Tablero del gerente: se lee SOLO del servicio Analytics (modelos de lectura armados con eventos) y se actualiza solo. */
export function DashboardView() {
  const { api } = useSession();
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
      setError(e instanceof ApiError ? e.message : 'We could not load the dashboard. Check your connection.');
    }
  }, [api]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  if (!data) {
    return error
      ? <div className={ui.panelError} role="alert"><strong>Something went wrong</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>Try again</button></div>
      : <p className={ui.muted} role="status">Loading the dashboard…</p>;
  }
  const t = data.totals;
  const f = data.freshness;

  return (
    <section aria-labelledby="dash-h" className={s.stack}>
      <div className={s.head}>
        <h2 id="dash-h" className={ui.h2}>Dashboard</h2>
        <p className={`${s.fresh} ${stale ? s.stale : ''}`}>
          <span className={s.live}><span className={s.liveDot} aria-hidden />{stale ? 'Not refreshing' : 'Live'}</span>
          <span>updated {timeAgo(data.asOf, now)}</span>
          {f.lastEventAt && <span>· last event {timeAgo(f.lastEventAt, now)}, reached the dashboard {f.lastEventLagMs} ms after it happened</span>}
        </p>
      </div>
      {stale && <p className={s.warn} role="status">We could not refresh just now ({error}). Showing the last data.</p>}

      <div className={ui.kpis}>
        <div className={ui.card}><small className={ui.muted}>Approved milestones</small><strong className={ui.kpi}>{t.milestonesApproved}</strong><span className={ui.kpiSub}>{formatCop(t.approvedCop)} COP</span></div>
        <div className={ui.card}><small className={ui.muted}>Waiting for an invoice</small><strong className={ui.kpi}>{t.waitingForInvoice.count}</strong><span className={ui.kpiSub}>{formatCop(t.waitingForInvoice.cop)} COP</span></div>
        <div className={ui.card}><small className={ui.muted}>Draft invoices</small><strong className={ui.kpi}>{t.draft.count}</strong><span className={ui.kpiSub}>{formatCop(t.draft.totalCop)} COP with IVA</span></div>
        <div className={ui.card}><small className={ui.muted}>Issued invoices</small><strong className={ui.kpi}>{t.issued.count}</strong><span className={ui.kpiSub}>{formatCop(t.issued.totalCop)} COP with IVA</span></div>
      </div>

      <section aria-labelledby="dash-proj-h">
        <h3 id="dash-proj-h" className={ui.h2}>By project</h3>
        <div className={ui.scroll}>
          <table className={`${ui.table} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>Approved and invoiced amounts for each project, in Colombian pesos</caption>
            <thead><tr><th>Project</th><th className={ui.num}>Approved</th><th className={ui.num}>Waiting for invoice</th><th className={ui.num}>Draft (with IVA)</th><th className={ui.num}>Issued (with IVA)</th></tr></thead>
            <tbody>
              {data.projects.length === 0
                ? <tr><td colSpan={5} className={ui.muted}>No approved milestones yet.</td></tr>
                : data.projects.map((p) => (
                  <tr key={p.projectName}>
                    <td>{p.projectName}</td>
                    <td className={ui.num} data-label="Approved">{p.milestonesApproved} · {formatCop(p.approvedCop)}</td>
                    <td className={ui.num} data-label="Waiting for invoice">{p.waitingForInvoice}</td>
                    <td className={ui.num} data-label="Draft (with IVA)">{formatCop(p.draftTotalCop)}</td>
                    <td className={ui.num} data-label="Issued (with IVA)">{formatCop(p.issuedTotalCop)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={ui.card} aria-labelledby="dash-act-h">
        <h3 id="dash-act-h" className={ui.h2}>Recent activity</h3>
        {data.recentActivity.length === 0
          ? <p className={ui.muted}>No events since Analytics started. Approve a milestone as the project lead and watch this list.</p>
          : (
            <ol className={s.activity}>
              {data.recentActivity.map((a, i) => (
                <li key={`${a.at}-${i}`}>
                  <span className={s.when}>{timeAgo(a.at, now)} · {KIND_LABEL[a.kind] ?? a.kind}</span>
                  <span className={s.msg}>{a.message}</span>
                </li>
              ))}
            </ol>
          )}
      </section>

      <TelemetryPanel />

      <p className={s.note}>Built only from events by the Analytics service, so it never reads the operational databases. Pending milestones are not shown: Projects does not publish an event when a milestone is created.</p>
    </section>
  );
}
