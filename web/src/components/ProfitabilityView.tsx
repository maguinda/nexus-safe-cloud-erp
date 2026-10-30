import { useCallback, useEffect, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import type { Profitability } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

/** Rentabilidad por proyecto (solo gerencia): ingresos de las facturas emitidas menos el costo laboral de las asignaciones. Dice cuando falta costo. */
export function ProfitabilityView() {
  const { api, t } = useSession();
  const alive = useAlive();
  const [data, setData] = useState<Profitability | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const r = await api.profitability(); if (alive.current) { setData(r); setError(''); } } catch (e) { if (alive.current) setError(t('prof.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  const pct = (v: number | null) => (v === null ? t('prof.noPct') : `${v.toLocaleString('es-CO')} %`);
  return (
    <section aria-labelledby="prof-h">
      <h2 id="prof-h" className={ui.h2}>{t('prof.title')}</h2>
      <p className={ui.muted}>{t('prof.intro')}</p>
      {error && <p className={ui.panelError} role="alert">{error}</p>}
      {data === null ? <p className={ui.muted} role="status">…</p> : data.projects.length === 0 ? <p className={ui.muted}>{t('prof.empty')}</p> : (
        <>
          {data.totals.uncostedAllocations > 0 && <p className={ui.panelError} role="status">{t('prof.uncosted', { n: data.totals.uncostedAllocations })}</p>}
          <div className={ui.scroll}>
            <table className={`${ui.table} ${ui.cardsOnPhone}`}>
              <caption className="sr-only">{t('prof.title')}</caption>
              <thead><tr><th>{t('prof.col.project')}</th><th className={ui.num}>{t('prof.col.revenue')}</th><th className={ui.num}>{t('prof.col.cost')}</th><th className={ui.num}>{t('prof.col.margin')}</th><th className={ui.num}>{t('prof.col.pct')}</th><th className={ui.num}>{t('prof.col.allocs')}</th></tr></thead>
              <tbody>
                {data.projects.map((p) => (
                  <tr key={p.projectName} data-project={p.projectName}>
                    <td>{p.projectName}{p.uncostedAllocations > 0 && <> · <span className={ui.err}>{t('prof.uncosted', { n: p.uncostedAllocations })}</span></>}</td>
                    <td className={ui.num} data-label={t('prof.col.revenue')}>{formatCop(p.revenueCop)}</td>
                    <td className={ui.num} data-label={t('prof.col.cost')}>{formatCop(p.laborCostCop)}</td>
                    <td className={ui.num} data-label={t('prof.col.margin')}>{formatCop(p.marginCop)}</td>
                    <td className={ui.num} data-label={t('prof.col.pct')}>{pct(p.marginPct)}</td>
                    <td className={ui.num} data-label={t('prof.col.allocs')}>{p.allocations}</td>
                  </tr>
                ))}
                <tr data-total>
                  <th scope="row">{t('prof.totals')}</th>
                  <td className={ui.num} data-label={t('prof.col.revenue')}>{formatCop(data.totals.revenueCop)}</td>
                  <td className={ui.num} data-label={t('prof.col.cost')}>{formatCop(data.totals.laborCostCop)}</td>
                  <td className={ui.num} data-label={t('prof.col.margin')}>{formatCop(data.totals.marginCop)}</td>
                  <td /><td />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
