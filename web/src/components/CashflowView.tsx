import { useCallback, useEffect, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import { barPct, cashScale, usedTone } from '../lib/finance';
import type { CashflowResponse, ProjectCostsResponse } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { KpiCard } from './KpiCard';
import { ProgressBar } from './shared/ProgressBar';
import { StatusChip } from './shared/StatusChip';
import s from './Finance.module.css';

const WINDOWS = [3, 6, 12] as const;

/** Flujo de caja (gerencia y finanzas): lo que entra y lo que sale mes a mes (tarjetas, gráfica y tabla), y el costo real de cada proyecto cotizado contra lo que decía la cotización. */
export function CashflowView() {
  const { api, t } = useSession();
  const alive = useAlive();
  const [months, setMonths] = useState<number>(6);
  const [cash, setCash] = useState<CashflowResponse | null>(null);
  const [costs, setCosts] = useState<ProjectCostsResponse | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const [c, p] = await Promise.all([api.cashflow(months), api.projectCosts()]); if (alive.current) { setCash(c); setCosts(p); setError(''); } } catch (e) { if (alive.current) setError(t('cf.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t, months]);
  useEffect(() => { void load(); }, [load]);

  const cop = (n: number) => formatCop(n);
  const any = cash !== null && cash.months.some((m) => m.inCop > 0 || m.outCop > 0);
  const scale = cash ? cashScale(cash.months) : 1;
  const sign = (n: number) => (n < 0 ? s.bad : n > 0 ? s.good : '');

  return (
    <section aria-labelledby="cf-h" className={s.stack}>
      <h2 id="cf-h" className={ui.h2}>{t('cf.title')}</h2>
      <p className={ui.muted}>{t('cf.intro')}</p>
      <div className={`${ui.seg} ${s.seg}`} role="group" aria-label={t('cf.months')}>
        {WINDOWS.map((n) => <button key={n} type="button" className={months === n ? ui.segBtnOn : ui.segBtn} aria-pressed={months === n} onClick={() => setMonths(n)}>{t('cf.monthsN', { n })}</button>)}
      </div>
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {cash === null && !error ? <p role="status" className={ui.muted}>{t('cf.loading')}</p> : cash && (
        <>
          <p className={s.lead} data-cf-totals>{t('cf.totals', { inc: cop(cash.totals.inCop), out: cop(cash.totals.outCop), net: cop(cash.totals.netCop), balance: cop(cash.balanceCop) })}</p>
          <div className={ui.kpis}>
            <KpiCard label={t('cf.kpi.in')} value={cop(cash.totals.inCop)} icon="check" tone={cash.totals.inCop > 0 ? 'ok' : undefined} sub={`COP · ${t('cf.kpi.window', { n: months })}`} />
            <KpiCard label={t('cf.kpi.out')} value={cop(cash.totals.outCop)} icon="receipt" tone={cash.totals.outCop > 0 ? 'warn' : undefined} sub={`COP · ${t('cf.kpi.window', { n: months })}`} />
            <KpiCard label={t('cf.kpi.net')} value={cop(cash.totals.netCop)} icon={cash.totals.netCop < 0 ? 'alert' : 'check'} tone={cash.totals.netCop < 0 ? 'bad' : cash.totals.netCop > 0 ? 'ok' : undefined} sub="COP" />
            <KpiCard label={t('cf.kpi.balance')} value={cop(cash.balanceCop)} icon={cash.balanceCop < 0 ? 'alert' : 'check'} tone={cash.balanceCop < 0 ? 'bad' : cash.balanceCop > 0 ? 'ok' : undefined} sub="COP" />
          </div>
          {!any ? <div className={s.empty} role="status">{t('cf.empty')}</div> : (
            <section className={s.panel} aria-labelledby="cf-chart-h">
              <h3 id="cf-chart-h" className={s.panelTitle}>{t('cf.chart.title')}</h3>
              <div className={s.chart} aria-hidden="true" data-cf-chart>
                {cash.months.map((m) => (
                  <div key={m.month} className={s.month}>
                    <div className={s.bars}>
                      <div className={s.barIn} style={{ height: `${barPct(m.inCop, scale)}%` }} />
                      <div className={s.barOut} style={{ height: `${barPct(m.outCop, scale)}%` }} />
                    </div>
                    <span className={s.monthLabel}>{m.month.slice(2)}</span>
                  </div>
                ))}
              </div>
              <div className={s.legend} aria-hidden="true"><span><span className={s.dotIn} />{t('cf.chart.in')}</span><span><span className={s.dotOut} />{t('cf.chart.out')}</span></div>
            </section>
          )}
          <div className={ui.scroll}>
            <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
              <caption className={s.sr}>{t('cf.table.caption')}</caption>
              <thead><tr><th>{t('cf.col.month')}</th><th className={s.num}>{t('cf.col.in')}</th><th className={s.num}>{t('cf.col.payroll')}</th><th className={s.num}>{t('cf.col.suppliers')}</th><th className={s.num}>{t('cf.col.out')}</th><th className={s.num}>{t('cf.col.net')}</th><th className={s.num}>{t('cf.col.balance')}</th></tr></thead>
              <tbody>
                {[...cash.months].reverse().map((m) => (
                  <tr key={m.month} data-month={m.month}>
                    <td className={s.number}>{m.month}</td>
                    <td className={s.num} data-label={t('cf.col.in')} data-col="in">{cop(m.inCop)}</td>
                    <td className={s.num} data-label={t('cf.col.payroll')} data-col="payroll">{cop(m.payrollCop)}</td>
                    <td className={s.num} data-label={t('cf.col.suppliers')} data-col="suppliers">{cop(m.supplierCop)}</td>
                    <td className={s.num} data-label={t('cf.col.out')} data-col="out">{cop(m.outCop)}</td>
                    <td className={`${s.num} ${sign(m.netCop)}`} data-label={t('cf.col.net')} data-col="net">{cop(m.netCop)}</td>
                    <td className={`${s.num} ${sign(m.balanceCop)}`} data-label={t('cf.col.balance')} data-col="balance">{cop(m.balanceCop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3 className={ui.h2}>{t('cf.costs.title')}</h3>
      <p className={ui.muted}>{t('cf.costs.intro')}</p>
      {costs && (costs.projects.length === 0 ? <div className={s.empty} role="status">{t('cf.costs.empty')}</div> : (
        <div className={ui.scroll}>
          <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>{t('cf.costs.caption')}</caption>
            <thead><tr><th>{t('cf.ccol.quote')}</th><th>{t('cf.ccol.project')}</th><th className={s.num}>{t('cf.ccol.quoted')}</th><th className={s.num}>{t('cf.ccol.price')}</th><th className={s.num}>{t('cf.ccol.margin')}</th><th className={s.num}>{t('cf.ccol.real')}</th><th className={s.num}>{t('cf.ccol.labor')}</th><th className={s.num}>{t('cf.ccol.suppliers')}</th><th>{t('cf.ccol.used')}</th></tr></thead>
            <tbody>
              {costs.projects.map((p) => {
                const tone = usedTone(p.usedPct);
                return (
                  <tr key={p.quoteNumber} data-cost={p.quoteNumber}>
                    <td className={s.number}>{p.quoteNumber}</td>
                    <td data-label={t('cf.ccol.project')} className={s.wide}><span className={s.what}>{p.projectName}</span></td>
                    <td className={s.num} data-label={t('cf.ccol.quoted')} data-col="quoted">{cop(p.quotedCostCop)}</td>
                    <td className={s.num} data-label={t('cf.ccol.price')} data-col="price">{cop(p.quotedPriceCop)}</td>
                    <td className={s.num} data-label={t('cf.ccol.margin')} data-col="margin">{p.quotedMarginPct} %</td>
                    <td className={s.num} data-label={t('cf.ccol.real')} data-col="real"><strong>{cop(p.realCostCop)}</strong></td>
                    <td className={s.num} data-label={t('cf.ccol.labor')} data-col="labor">{cop(p.laborCostCop)}</td>
                    <td className={s.num} data-label={t('cf.ccol.suppliers')} data-col="suppliers">{cop(p.purchasesPaidCop)}</td>
                    <td data-label={t('cf.ccol.used')} data-col="used">
                      <span className={s.mini}>
                        {p.usedPct === null ? <span className={ui.muted}>{t('cf.costs.noCost')}</span> : <ProgressBar value={Math.min(p.usedPct, 100)} tone={tone === 'ok' || tone === 'warn' || tone === 'bad' ? tone : undefined} label={t('cf.costs.bar')} caption={t('cf.costs.used', { pct: p.usedPct })} />}
                        <StatusChip tone={tone}>{t(`cf.tone.${tone}` as 'cf.tone.ok')}</StatusChip>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
