import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import { payrollTone } from '../lib/finance';
import type { PayrollLine, PayrollRun } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { KpiCard } from './KpiCard';
import { StatusChip } from './shared/StatusChip';
import s from './Finance.module.css';

/** Nómina mensual (gerencia y finanzas): una corrida por mes con una foto de cada persona; se marca pagada una sola vez. */
export function PayrollView({ toast }: { toast: (m: string) => void }) {
  const { api, t } = useSession();
  const alive = useAlive();
  const [rows, setRows] = useState<PayrollRun[] | null>(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [periodError, setPeriodError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [lines, setLines] = useState<PayrollLine[] | null>(null);
  const [busy, setBusy] = useState('');
  const inflight = useRef(false);

  const load = useCallback(async () => {
    try { const r = await api.payrolls(); if (alive.current) { setRows(r); setError(''); } } catch (e) { if (alive.current) setError(t('payroll.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, work: () => Promise<string>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(key);
    try { toast(await work()); await load(); } catch (e) { toast(t('payroll.failed', { reason: errorText(e, t, 'server.unexpected') })); } finally { inflight.current = false; if (alive.current) setBusy(''); }
  }

  function generate(e: FormEvent) {
    e.preventDefault();
    const p = period.trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) { setPeriodError(t('payroll.v.period')); return; }
    setPeriodError('');
    void act('gen', async () => { const r = await api.generatePayroll(p); return t('payroll.generated', { period: r.period, headcount: r.headcount, total: formatCop(r.totalCop) }); });
  }

  async function toggle(r: PayrollRun) {
    if (openId === r.id) { setOpenId(null); return; }
    setOpenId(r.id); setLines(null);
    try { const d = await api.payroll(r.id); if (alive.current) setLines(d.lines); } catch (e) { toast(t('payroll.failed', { reason: errorText(e, t, 'server.unexpected') })); setOpenId(null); }
  }

  const now = Date.now();
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => b.period.localeCompare(a.period)), [rows]);
  const last = sorted[0];
  const lastTone = last ? payrollTone(last, now) : 'neutral';
  const label = (r: PayrollRun) => (r.status === 'paid' ? t('payroll.status.paid') : payrollTone(r, now) === 'bad' ? t('payroll.status.late') : t('payroll.status.generated'));

  return (
    <section aria-labelledby="pay-h" className={s.stack}>
      <h2 id="pay-h" className={ui.h2}>{t('payroll.title')}</h2>
      <p className={ui.muted}>{t('payroll.intro')}</p>
      <form onSubmit={generate} noValidate aria-label={t('payroll.generate')} className={ui.formCard}>
        <label className={ui.field}><span>{t('payroll.period')}</span><input type="text" autoComplete="off" maxLength={7} value={period} onChange={(e) => setPeriod(e.target.value)} aria-invalid={!!periodError} />{periodError && <span className={ui.err} role="alert">{periodError}</span>}</label>
        <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy === 'gen'}>{t('payroll.generate')}</button></div>
      </form>
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {rows === null && !error ? <p role="status" className={ui.muted}>{t('payroll.loading')}</p> : rows && (
        <>
          <div className={ui.kpis}>
            <KpiCard label={t('payroll.kpi.last')} value={last ? last.period : '—'} icon="document" sub={last ? undefined : t('payroll.kpi.none')} />
            <KpiCard label={t('payroll.kpi.total')} value={last ? formatCop(last.totalCop) : '—'} icon="receipt" sub="COP" />
            <KpiCard label={t('payroll.kpi.people')} value={last ? last.headcount : '—'} icon="users" />
            <KpiCard label={t('payroll.kpi.status')} value={last ? label(last) : '—'} icon={lastTone === 'ok' ? 'check' : lastTone === 'bad' ? 'alert' : 'clock'} tone={lastTone === 'ok' || lastTone === 'warn' || lastTone === 'bad' ? lastTone : undefined} />
          </div>
          {sorted.length === 0 ? <div className={s.empty} role="status">{t('payroll.empty')}</div> : (
            <div className={ui.scroll}>
              <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
                <caption className={s.sr}>{t('payroll.caption')}</caption>
                <thead><tr><th>{t('payroll.col.period')}</th><th className={s.num}>{t('payroll.col.people')}</th><th className={s.num}>{t('payroll.col.total')} (COP)</th><th>{t('payroll.col.status')}</th><th>{t('payroll.col.by')}</th><th>{t('payroll.col.paid')}</th><th>{t('payroll.col.action')}</th></tr></thead>
                <tbody>
                  {sorted.flatMap((r) => {
                    const tone = payrollTone(r, now);
                    const main = (
                      <tr key={r.id} data-payroll={r.period} data-status={r.status}>
                        <td className={s.number}>{r.period}</td>
                        <td className={s.num} data-label={t('payroll.col.people')}>{r.headcount}</td>
                        <td className={s.num} data-label={t('payroll.col.total')}><strong>{formatCop(r.totalCop)}</strong></td>
                        <td data-label={t('payroll.col.status')}><StatusChip tone={tone}>{label(r)}</StatusChip></td>
                        <td data-label={t('payroll.col.by')} className={ui.muted}>{r.generatedBy}</td>
                        <td data-label={t('payroll.col.paid')} className={ui.muted}>{r.paidBy ?? '—'}</td>
                        <td data-label={t('payroll.col.action')}>
                          <span className={s.rowActions}>
                            <button type="button" className={ui.btnGhost} aria-expanded={openId === r.id} aria-label={t('payroll.openFor', { period: r.period })} onClick={() => void toggle(r)}>{openId === r.id ? t('payroll.close') : t('payroll.open')}</button>
                            {r.status === 'generated' && <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('payroll.payFor', { period: r.period })} onClick={() => void act(`p:${r.id}`, async () => { await api.payPayroll(r.id); return t('payroll.paid', { period: r.period }); })}>{t('payroll.pay')}</button>}
                          </span>
                        </td>
                      </tr>
                    );
                    if (openId !== r.id) return [main];
                    return [main, (
                      <tr key={`${r.id}-d`} className={s.subRow}>
                        <td colSpan={7}>
                          {lines === null ? <p role="status" className={ui.muted}>…</p> : (
                            <div className={ui.scroll}>
                              <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
                                <caption className={s.sr}>{t('payroll.lines.caption', { period: r.period })}</caption>
                                <thead><tr><th>{t('payroll.lcol.name')}</th><th>{t('payroll.lcol.position')}</th><th className={s.num}>{t('payroll.lcol.salary')}</th><th className={s.num}>{t('payroll.lcol.aid')}</th><th className={s.num}>{t('payroll.lcol.prest')}</th><th className={s.num}>{t('payroll.lcol.pension')}</th><th className={s.num}>{t('payroll.lcol.caja')}</th><th className={s.num}>{t('payroll.lcol.arl')}</th><th className={s.num}>{t('payroll.lcol.cost')} (COP)</th></tr></thead>
                                <tbody>
                                  {lines.map((l) => (
                                    <tr key={l.engineerId} data-person={l.name}>
                                      <td><span className={s.what}>{l.name}</span></td>
                                      <td data-label={t('payroll.lcol.position')}>{t(`position.${l.position}` as 'position.tech_lead')}</td>
                                      <td className={s.num} data-label={t('payroll.lcol.salary')} data-col="salary">{formatCop(l.salaryCop)}</td>
                                      <td className={s.num} data-label={t('payroll.lcol.aid')} data-col="aid">{formatCop(l.transportAidCop)}</td>
                                      <td className={s.num} data-label={t('payroll.lcol.prest')} data-col="prest">{formatCop(l.prestacionesCop)}</td>
                                      <td className={s.num} data-label={t('payroll.lcol.pension')} data-col="pension">{formatCop(l.pensionCop)}</td>
                                      <td className={s.num} data-label={t('payroll.lcol.caja')} data-col="caja">{formatCop(l.cajaCop)}</td>
                                      <td className={s.num} data-label={t('payroll.lcol.arl')} data-col="arl">{formatCop(l.arlCop)}</td>
                                      <td className={s.num} data-label={t('payroll.lcol.cost')} data-col="cost"><strong>{formatCop(l.employerCostCop)}</strong></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
