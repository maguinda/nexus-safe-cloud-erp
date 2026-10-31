import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import { closingChecklist, payrollTone, summarizePayables } from '../lib/finance';
import type { CashflowResponse, PayablesResponse, PayrollRun, ProjectCostsResponse } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { KpiCard } from './KpiCard';
import { Checklist, type CheckItem } from './shared/Checklist';
import s from './Finance.module.css';

export type FinanceTarget = 'payroll' | 'payables' | 'cashflow';
const TARGET = { payrollGenerated: 'payroll', payrollPaid: 'payroll', payablesOverdue: 'payables', budget: 'cashflow' } as const;

/** Resumen financiero (finanzas): cómo va el cierre del mes (hecho / en curso / falta), lo que se debe y el saldo, con un botón a la pantalla de cada cosa. Solo lee. */
export function FinanceSummaryView({ onGo }: { onGo: (to: FinanceTarget) => void }) {
  const { api, t } = useSession();
  const alive = useAlive();
  const [payrolls, setPayrolls] = useState<PayrollRun[] | null>(null);
  const [payables, setPayables] = useState<PayablesResponse | null>(null);
  const [cash, setCash] = useState<CashflowResponse | null>(null);
  const [costs, setCosts] = useState<ProjectCostsResponse | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, a, c, k] = await Promise.all([api.payrolls(), api.payables(), api.cashflow(6), api.projectCosts()]);
      if (alive.current) { setPayrolls(p); setPayables(a); setCash(c); setCosts(k); setError(''); }
    } catch (e) { if (alive.current) setError(t('fs.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  const ready = payrolls !== null && payables !== null && cash !== null && costs !== null;
  const period = new Date(now).toISOString().slice(0, 7);
  const sum = useMemo(() => summarizePayables(payables?.payables ?? [], Date.now()), [payables]);
  const items: CheckItem[] = useMemo(() => !ready ? [] : closingChecklist(Date.now(), payrolls, payables.payables, costs.projects).map((i) => {
    const key = `fs.c.${i.key}.${i.state}` as 'fs.c.payrollPaid.done';
    return {
      key: i.key, state: i.state,
      label: t(key, { period: i.period ?? period, n: i.n ?? 0 }),
      trailing: i.state === 'done' ? null : <button type="button" className={ui.btnGhost} onClick={() => onGo(TARGET[i.key])}>{t(`fs.go.${TARGET[i.key]}` as 'fs.go.payroll')}</button>,
    };
  }), [ready, payrolls, payables, costs, t, period, onGo]);

  const run = payrolls?.find((r) => r.period === period);
  const runTone = run ? payrollTone(run, now) : 'neutral';

  return (
    <section aria-labelledby="fs-h" className={s.stack}>
      <h2 id="fs-h" className={ui.h2}>{t('fs.title')}</h2>
      <p className={ui.muted}>{t('fs.intro')}</p>
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {!ready && !error ? <p role="status" className={ui.muted}>{t('fs.loading')}</p> : ready && (
        <>
          <div className={ui.kpis}>
            <KpiCard label={t('fs.kpi.open')} value={formatCop(sum.openCop)} icon="receipt" sub={t('fs.kpi.n', { n: sum.open })} />
            <KpiCard label={t('fs.kpi.overdue')} value={formatCop(sum.overdueCop)} icon={sum.overdue > 0 ? 'alert' : 'check'} tone={sum.overdue > 0 ? 'bad' : 'ok'} sub={sum.overdue > 0 ? t('fs.kpi.n', { n: sum.overdue }) : t('fs.kpi.none')} />
            <KpiCard label={t('fs.kpi.payroll', { period })} value={run ? formatCop(run.totalCop) : '—'} icon="users" tone={run ? (runTone === 'ok' || runTone === 'warn' || runTone === 'bad' ? runTone : undefined) : undefined} sub={run ? t(run.status === 'paid' ? 'fs.kpi.paid' : 'fs.kpi.generated') : t('fs.kpi.noRun')} />
            <KpiCard label={t('fs.kpi.balance')} value={formatCop(cash.balanceCop)} icon={cash.balanceCop < 0 ? 'alert' : 'check'} tone={cash.balanceCop < 0 ? 'bad' : cash.balanceCop > 0 ? 'ok' : undefined} sub="COP" />
          </div>
          <section className={s.panel} aria-labelledby="fs-close-h">
            <h3 id="fs-close-h" className={s.panelTitle}>{t('fs.close.title', { period })}</h3>
            <Checklist items={items} ariaLabel={t('fs.close.label')} labels={{ done: t('fs.state.done'), doing: t('fs.state.doing'), todo: t('fs.state.todo'), bad: t('fs.state.bad') }} />
          </section>
        </>
      )}
    </section>
  );
}
