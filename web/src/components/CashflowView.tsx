import { useCallback, useEffect, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import type { CashflowResponse, ProjectCostsResponse } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './QuotesView.module.css';

const WINDOWS = [3, 6, 12] as const;

/** Flujo de caja (gerencia y finanzas): lo que entra y lo que sale mes a mes, y el costo real de cada proyecto cotizado contra lo que decía la cotización. */
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

  return (
    <section aria-labelledby="cf-h" className={s.stack}>
      <h2 id="cf-h" className={ui.h2}>{t('cf.title')}</h2>
      <p className={ui.muted}>{t('cf.intro')}</p>
      <div className={ui.seg} role="group" aria-label={t('cf.months')}>
        {WINDOWS.map((n) => <button key={n} type="button" className={months === n ? ui.segBtnOn : ui.segBtn} aria-pressed={months === n} onClick={() => setMonths(n)}>{t('cf.monthsN', { n })}</button>)}
      </div>
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {cash === null && !error ? <p role="status" className={ui.muted}>{t('cf.loading')}</p> : cash && (
        <>
          <p className={s.total} data-cf-totals>{t('cf.totals', { inc: cop(cash.totals.inCop), out: cop(cash.totals.outCop), net: cop(cash.totals.netCop), balance: cop(cash.balanceCop) })}</p>
          {!any && <p className={ui.muted}>{t('cf.empty')}</p>}
          <ul className={s.rates}>
            {[...cash.months].reverse().map((m) => <li key={m.month} className={s.rate} data-month={m.month}>{t('cf.row', { month: m.month, inc: cop(m.inCop), out: cop(m.outCop), payroll: cop(m.payrollCop), suppliers: cop(m.supplierCop), net: cop(m.netCop), balance: cop(m.balanceCop) })}</li>)}
          </ul>
        </>
      )}
      <h3 className={ui.h2}>{t('cf.costs.title')}</h3>
      <p className={ui.muted}>{t('cf.costs.intro')}</p>
      {costs && (costs.projects.length === 0 ? <p className={ui.muted}>{t('cf.costs.empty')}</p> : (
        <ul className={s.rates}>
          {costs.projects.map((p) => <li key={p.quoteNumber} className={s.rate} data-cost={p.quoteNumber}>{t('cf.costs.row', { quote: p.quoteNumber, project: p.projectName, quoted: cop(p.quotedCostCop), price: cop(p.quotedPriceCop), margin: p.quotedMarginPct, real: cop(p.realCostCop), labor: cop(p.laborCostCop), suppliers: cop(p.purchasesPaidCop), used: p.usedPct === null ? t('cf.costs.noCost') : t('cf.costs.used', { pct: p.usedPct }) })}</li>)}
        </ul>
      ))}
    </section>
  );
}
