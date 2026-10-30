import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import type { PayrollLine, PayrollRun } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './QuotesView.module.css';

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

  return (
    <section aria-labelledby="pay-h" className={s.stack}>
      <h2 id="pay-h" className={ui.h2}>{t('payroll.title')}</h2>
      <p className={ui.muted}>{t('payroll.intro')}</p>
      <form onSubmit={generate} noValidate aria-label={t('payroll.generate')} className={ui.formCard}>
        <label className={ui.field}><span>{t('payroll.period')}</span><input type="text" autoComplete="off" maxLength={7} value={period} onChange={(e) => setPeriod(e.target.value)} aria-invalid={!!periodError} />{periodError && <span className={ui.err}>{periodError}</span>}</label>
        <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy === 'gen'}>{t('payroll.generate')}</button></div>
      </form>
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {rows === null && !error ? <p role="status" className={ui.muted}>{t('payroll.loading')}</p> : rows && rows.length === 0 ? <p className={ui.muted}>{t('payroll.empty')}</p> : (
        <ul className={s.list}>
          {(rows ?? []).map((r) => (
            <li key={r.id} className={s.card} data-payroll={r.period} data-status={r.status}>
              <div className={s.head}>
                <div><h3 className={s.title}>{t('payroll.row', { period: r.period, headcount: r.headcount, total: formatCop(r.totalCop) })} <span className={r.status === 'paid' ? s.badgeOk : s.badgeWarn}>{t(`payroll.status.${r.status}` as 'pay.status.paid')}</span></h3>
                  <span className={s.note}>{t('payroll.by', { who: r.generatedBy })}{r.paidBy ? ` · ${t('payroll.paidBy', { who: r.paidBy })}` : ''}</span></div>
                <div className={s.actions}>
                  <button type="button" className={ui.btnGhost} aria-expanded={openId === r.id} aria-label={t('payroll.openFor', { period: r.period })} onClick={() => void toggle(r)}>{openId === r.id ? t('payroll.close') : t('payroll.open')}</button>
                  {r.status === 'generated' && <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('payroll.payFor', { period: r.period })} onClick={() => void act(`p:${r.id}`, async () => { const x = await api.payPayroll(r.id); return t('payroll.paid', { period: x.period }); })}>{t('payroll.pay')}</button>}
                </div>
              </div>
              {openId === r.id && (lines === null ? <p role="status" className={ui.muted}>…</p> : (
                <ul className={s.rates}>
                  {lines.map((l) => <li key={l.engineerId} className={s.rate} data-person={l.name}>{t('payroll.line', { name: l.name, position: t(`position.${l.position}` as 'position.tech_lead'), salary: formatCop(l.salaryCop), aid: formatCop(l.transportAidCop), prest: formatCop(l.prestacionesCop), pension: formatCop(l.pensionCop), caja: formatCop(l.cajaCop), arl: formatCop(l.arlCop), cost: formatCop(l.employerCostCop) })}</li>)}
                </ul>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
