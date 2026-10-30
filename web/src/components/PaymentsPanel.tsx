import { FormEvent, useRef, useState } from 'react';
import { errorText } from '../i18n/server';
import { formatCop, formatDay } from '../lib/format';
import { checkPayment, METHOD_KEY, METHODS, REFERENCE_MAX } from '../lib/payments';
import type { PaymentErrors } from '../lib/payments';
import type { Invoice, InvoicePayment } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './PaymentsPanel.module.css';

const statusOf = (i: Invoice) => i.paymentStatus ?? 'unpaid';

/** Pagos de las facturas EMITIDAS (solo el analista de facturación). Se valida aquí con los mismos criterios del servidor, que vuelve a validar y que decide con la factura bloqueada. */
export function PaymentsPanel({ invoices, reload, toast }: { invoices: Invoice[]; reload: () => Promise<void>; toast: (m: string) => void }) {
  const { api, t, lang } = useSession();
  const rows = invoices.filter((i) => i.status === 'issued');
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<InvoicePayment[] | null>(null);
  const [f, setF] = useState({ amount: '', method: '', reference: '' });
  const [errors, setErrors] = useState<PaymentErrors & { form?: string }>({});
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const open = (n: string) => { setOpenFor(n); setF({ amount: '', method: '', reference: '' }); setErrors({}); };
  async function showHistory(n: string) {
    if (historyFor === n) { setHistoryFor(null); return; }
    setHistoryFor(n); setHistory(null);
    try { setHistory(await api.payments(n)); } catch (e) { toast(t('pay.failed', { reason: errorText(e, t, 'server.unexpected') })); setHistoryFor(null); }
  }
  async function submit(e: FormEvent, i: Invoice) {
    e.preventDefault();
    if (inflight.current) return; // un doble clic rapidísimo llega antes de que React repinte
    const { errors: errs, value } = checkPayment(t, f, i.balanceCop ?? i.totalCop);
    setErrors(errs);
    if (!value) return;
    inflight.current = true; setBusy(true);
    try {
      const r = await api.registerPayment(i.number, value);
      toast(r.balanceCop === 0 ? t('pay.savedFull', { amount: formatCop(value.amountCop), n: i.number }) : t('pay.saved', { amount: formatCop(value.amountCop), n: i.number, balance: formatCop(r.balanceCop) }));
      setOpenFor(null); if (historyFor === i.number) setHistory(await api.payments(i.number));
    } catch (err) { setErrors({ form: t('pay.failed', { reason: errorText(err, t, 'server.unexpected') }) }); }
    finally { inflight.current = false; setBusy(false); await reload(); }
  }

  return (
    <section aria-labelledby="pay-h" className={s.stack}>
      <h2 id="pay-h" className={ui.h2}>{t('pay.title')}</h2>
      <p className={ui.muted}>{t('pay.intro')}</p>
      {rows.length === 0 ? <p className={ui.muted}>{t('pay.empty')}</p> : (
        <ul className={s.list} aria-label={t('pay.caption')}>
          {rows.map((i) => {
            const st = statusOf(i); const balance = i.balanceCop ?? i.totalCop;
            return (
              <li key={i.number} className={s.card} data-invoice={i.number}>
                <div className={s.head}>
                  <strong>{i.number}{i.clientName ? ` · ${i.clientName}` : ''}</strong>
                  <span className={`${s.chip} ${st === 'paid' ? s.chipOk : st === 'partial' ? s.chipWarn : ''}`}>{t(`pay.status.${st}` as 'pay.status.paid')}</span>
                </div>
                <p className={s.nums}>
                  <span>{t('pay.col.total')}: {formatCop(i.totalCop)} COP</span><span>{t('pay.col.paid')}: {formatCop(i.paidCop ?? 0)} COP</span><span>{t('pay.col.balance')}: {formatCop(balance)} COP</span>
                </p>
                <div className={s.actions}>
                  {balance > 0 && openFor !== i.number && <button type="button" className={ui.btn} aria-label={t('pay.registerFor', { n: i.number })} onClick={() => open(i.number)}>{t('pay.register')}</button>}
                  <button type="button" className={ui.btnGhost} aria-expanded={historyFor === i.number} aria-label={t('pay.historyFor', { n: i.number })} onClick={() => void showHistory(i.number)}>{historyFor === i.number ? t('pay.hide') : t('pay.history')}</button>
                </div>
                {historyFor === i.number && (history === null ? <p className={ui.muted} role="status">…</p> : history.length === 0 ? <p className={ui.muted}>{t('pay.noPayments')}</p> : (
                  <ul className={s.history}>{history.map((p) => <li key={p.id}>{t('pay.payLine', { amount: formatCop(p.amountCop), method: t(METHOD_KEY[p.method]), date: formatDay(p.paidAt, lang) })}{p.reference ? ` · ${p.reference}` : ''}</li>)}</ul>
                ))}
                {openFor === i.number && (
                  <form onSubmit={(e) => void submit(e, i)} noValidate aria-label={t('pay.registerFor', { n: i.number })} className={ui.formCard}>
                    <div className={ui.formGrid}>
                      <label className={ui.field}><span>{t('pay.field.amount', { balance: formatCop(balance) })}</span>
                        <input type="text" inputMode="numeric" autoComplete="off" maxLength={12} value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} aria-invalid={!!errors.amount} />
                        {errors.amount && <span className={ui.err}>{errors.amount}</span>}</label>
                      <fieldset className={ui.field}><legend>{t('pay.field.method')}</legend>
                        <div className={ui.seg}>{METHODS.map((m) => <button key={m} type="button" className={f.method === m ? ui.segBtnOn : ui.segBtn} aria-pressed={f.method === m} onClick={() => setF({ ...f, method: m })}>{t(METHOD_KEY[m])}</button>)}</div>
                        {errors.method && <span className={ui.err}>{errors.method}</span>}</fieldset>
                      <label className={ui.field}><span>{t('pay.field.reference')}</span>
                        <input type="text" autoComplete="off" maxLength={REFERENCE_MAX + 40} value={f.reference} onChange={(x) => setF({ ...f, reference: x.target.value })} aria-invalid={!!errors.reference} />
                        {errors.reference && <span className={ui.err}>{errors.reference}</span>}</label>
                    </div>
                    {errors.form && <p className={ui.err} role="alert">{errors.form}</p>}
                    <div className={ui.formActions}>
                      <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('pay.saving') : t('pay.save')}</button>
                      <button type="button" className={ui.btnGhost} onClick={() => setOpenFor(null)}>{t('pay.cancel')}</button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
