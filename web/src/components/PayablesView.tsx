import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop, formatDay } from '../lib/format';
import { dueChip } from '../lib/invoice-table';
import { filterPayables, payableDue, summarizePayables, type PayableFilter } from '../lib/finance';
import type { Payable, PayablesResponse } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { KpiCard } from './KpiCard';
import { StatusChip } from './shared/StatusChip';
import s from './Finance.module.css';

const METHODS = ['transfer', 'cash', 'card', 'check'] as const;
const FILTERS: PayableFilter[] = ['open', 'overdue', 'paid', 'all'];

/** Cuentas por pagar (gerencia y finanzas): lo que se debe a los proveedores por pedidos recibidos, con semáforo de vencimiento; el pago se registra una sola vez. */
export function PayablesView({ toast }: { toast: (m: string) => void }) {
  const { api, t, lang } = useSession();
  const alive = useAlive();
  const [data, setData] = useState<PayablesResponse | null>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState<string | null>(null);
  const [method, setMethod] = useState<string>('');
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<PayableFilter>('all');
  const inflight = useRef(false);

  const load = useCallback(async () => {
    try { const r = await api.payables(); if (alive.current) { setData(r); setError(''); } } catch (e) { if (alive.current) setError(t('ap.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  async function confirm(e: FormEvent, p: Payable) {
    e.preventDefault();
    if (inflight.current) return;
    const ref = reference.replace(/\s+/g, ' ').trim();
    if (!method) { setFormError(t('ap.v.method')); return; }
    // eslint-disable-next-line no-control-regex
    if (ref && (ref.length < 3 || ref.length > 60 || /[\u0000-\u001f<>]/.test(ref))) { setFormError(t('ap.v.reference')); return; }
    setFormError(''); inflight.current = true; setBusy(true);
    try { await api.payPayable(p.id, method, ref || undefined); toast(t('ap.paid', { number: p.number })); setPaying(null); await load(); }
    catch (x) { setFormError(t('ap.failed', { reason: errorText(x, t, 'server.unexpected') })); } finally { inflight.current = false; if (alive.current) setBusy(false); }
  }

  const now = Date.now();
  const list = data?.payables ?? [];
  const sum = useMemo(() => summarizePayables(list, Date.now()), [list]);
  const shown = useMemo(() => filterPayables(list, filter, Date.now()), [list, filter]);
  const counts: Record<PayableFilter, number> = { open: sum.open, overdue: sum.overdue, paid: sum.paid, all: list.length };
  const day = (d: string) => formatDay(`${d}T00:00:00Z`, lang);

  return (
    <section aria-labelledby="ap-h" className={s.stack}>
      <h2 id="ap-h" className={ui.h2}>{t('ap.title')}</h2>
      <p className={ui.muted}>{t('ap.intro')}</p>
      {data && <p className={s.lead} data-ap-totals>{t('ap.totals', { open: formatCop(data.openCop), overdue: formatCop(data.overdueCop) })}</p>}
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {data === null && !error ? <p role="status" className={ui.muted}>{t('ap.loading')}</p> : data && (
        <>
          <div className={ui.kpis}>
            <KpiCard label={t('ap.kpi.open')} value={formatCop(sum.openCop)} icon="receipt" sub={t('ap.kpi.n', { n: sum.open })} />
            <KpiCard label={t('ap.kpi.overdue')} value={formatCop(sum.overdueCop)} icon={sum.overdue > 0 ? 'alert' : 'check'} tone={sum.overdue > 0 ? 'bad' : 'ok'} sub={sum.overdue > 0 ? t('ap.kpi.n', { n: sum.overdue }) : t('ap.kpi.none')} />
            <KpiCard label={t('ap.kpi.soon')} value={formatCop(sum.soonCop)} icon="clock" tone={sum.soon > 0 ? 'warn' : undefined} sub={sum.soon > 0 ? t('ap.kpi.n', { n: sum.soon }) : t('ap.kpi.none')} />
            <KpiCard label={t('ap.kpi.paid')} value={formatCop(sum.paidCop)} icon="check" tone={sum.paid > 0 ? 'ok' : undefined} sub={t('ap.kpi.n', { n: sum.paid })} />
          </div>
          {list.length === 0 ? <div className={s.empty} role="status">{t('ap.empty')}</div> : (
            <>
              <div className={`${ui.seg} ${s.seg}`} role="group" aria-label={t('ap.filter.label')}>
                {FILTERS.map((f) => <button key={f} type="button" className={filter === f ? ui.segBtnOn : ui.segBtn} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`ap.filter.${f}` as 'ap.filter.all')} ({counts[f]})</button>)}
              </div>
              {shown.length === 0 ? <div className={s.empty} role="status">{t('ap.noMatch')}</div> : (
                <div className={ui.scroll}>
                  <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
                    <caption className={s.sr}>{t('ap.caption')}</caption>
                    <thead><tr><th>{t('ap.col.number')}</th><th>{t('ap.col.supplier')}</th><th>{t('ap.col.project')}</th><th className={s.num}>{t('ap.col.amount')} (COP)</th><th>{t('ap.col.due')}</th><th>{t('ap.col.status')}</th><th>{t('ap.col.action')}</th></tr></thead>
                    <tbody>
                      {shown.flatMap((p) => {
                        const due = payableDue(p, now);
                        const chip = dueChip(due, t);
                        const statusChip = p.status === 'paid'
                          ? <StatusChip tone="ok">{t('ap.status.paid')}</StatusChip>
                          : due.state === 'overdue' ? <StatusChip tone="bad">{t('ap.status.overdue')}</StatusChip>
                          : due.state === 'soon' ? <StatusChip tone="warn">{t('ap.status.soon')}</StatusChip>
                          : <StatusChip tone="neutral">{t('ap.status.open')}</StatusChip>;
                        const row = (
                          <tr key={p.id} data-payable={p.number} data-status={p.status}>
                            <td className={s.number}>{p.number}</td>
                            <td data-label={t('ap.col.supplier')}><span className={s.what}>{p.supplierName}</span></td>
                            <td data-label={t('ap.col.project')} className={ui.muted}>{p.projectName ?? '—'}</td>
                            <td className={s.num} data-label={t('ap.col.amount')} data-col="amount"><strong>{formatCop(p.amountCop)}</strong></td>
                            <td data-label={t('ap.col.due')} data-col="due"><span className={s.dueCell}><span className={ui.muted}>{day(p.dueDate)}</span>{p.status === 'open' && chip && <StatusChip tone={due.state === 'overdue' ? 'bad' : 'warn'}>{chip}</StatusChip>}</span></td>
                            <td data-label={t('ap.col.status')}>{statusChip}</td>
                            <td data-label={t('ap.col.action')}>
                              {p.status === 'open'
                                ? (paying !== p.id && <button type="button" className={ui.btn} aria-label={t('ap.payFor', { number: p.number })} onClick={() => { setPaying(p.id); setMethod(''); setReference(''); setFormError(''); }}>{t('ap.pay')}</button>)
                                : <span className={ui.muted}>{t('ap.paidLine', { who: p.paidBy ?? '—', method: t(`ap.method.${p.method ?? 'cash'}` as 'ap.method.cash'), ref: p.reference ? ` · ${p.reference}` : '' })}</span>}
                            </td>
                          </tr>
                        );
                        if (paying !== p.id) return [row];
                        return [row, (
                          <tr key={`${p.id}-f`} className={s.subRow}>
                            <td colSpan={7}>
                              <form noValidate aria-label={t('ap.payFor', { number: p.number })} className={s.form} onSubmit={(e) => void confirm(e, p)}>
                                <fieldset className={ui.field}><legend>{t('ap.field.method')}</legend>
                                  <div className={ui.chips}>{METHODS.map((m) => <button key={m} type="button" className={method === m ? ui.chipOn : ui.chip} aria-pressed={method === m} onClick={() => setMethod(m)}>{t(`ap.method.${m}` as 'ap.method.cash')}</button>)}</div>
                                </fieldset>
                                <label className={ui.field}><span>{t('ap.field.reference')}</span><input type="text" autoComplete="off" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
                                {formError && <p className={ui.err} role="alert">{formError}</p>}
                                <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{t('ap.confirm')}</button><button type="button" className={ui.btnGhost} onClick={() => setPaying(null)}>{t('ap.cancel')}</button></div>
                              </form>
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
        </>
      )}
    </section>
  );
}
