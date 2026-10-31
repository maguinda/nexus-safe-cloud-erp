import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import type { Payable, PayablesResponse } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './QuotesView.module.css';

const METHODS = ['transfer', 'cash', 'card', 'check'] as const;

/** Cuentas por pagar (gerencia y finanzas): lo que se debe a los proveedores por pedidos recibidos; el pago se registra una sola vez. */
export function PayablesView({ toast }: { toast: (m: string) => void }) {
  const { api, t } = useSession();
  const alive = useAlive();
  const [data, setData] = useState<PayablesResponse | null>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState<string | null>(null);
  const [method, setMethod] = useState<string>('');
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
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

  return (
    <section aria-labelledby="ap-h" className={s.stack}>
      <h2 id="ap-h" className={ui.h2}>{t('ap.title')}</h2>
      <p className={ui.muted}>{t('ap.intro')}</p>
      {data && <p className={s.total} data-ap-totals>{t('ap.totals', { open: formatCop(data.openCop), overdue: formatCop(data.overdueCop) })}</p>}
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {data === null && !error ? <p role="status" className={ui.muted}>{t('ap.loading')}</p> : data && data.payables.length === 0 ? <p className={ui.muted}>{t('ap.empty')}</p> : (
        <ul className={s.list}>
          {(data?.payables ?? []).map((p) => (
            <li key={p.id} className={s.card} data-payable={p.number} data-status={p.status}>
              <div className={s.head}>
                <div>
                  <h3 className={s.title}>{t('ap.row', { number: p.number, supplier: p.supplierName, amount: formatCop(p.amountCop) })} <span className={p.status === 'paid' ? s.badgeOk : p.overdue ? s.badgeBad : s.badgeWarn}>{t(p.status === 'paid' ? 'ap.status.paid' : p.overdue ? 'ap.status.overdue' : 'ap.status.open')}</span></h3>
                  <span className={s.note}>{t('ap.due', { date: p.dueDate })}{p.projectName ? ` · ${t('ap.project', { project: p.projectName })}` : ''}</span>
                  {p.status === 'paid' && <p className={s.note}>{t('ap.paidLine', { who: p.paidBy ?? '—', method: t(`ap.method.${p.method ?? 'cash'}` as 'ap.method.cash'), ref: p.reference ? ` · ${p.reference}` : '' })}</p>}
                </div>
                {p.status === 'open' && paying !== p.id && <button type="button" className={ui.btn} aria-label={t('ap.payFor', { number: p.number })} onClick={() => { setPaying(p.id); setMethod(''); setReference(''); setFormError(''); }}>{t('ap.pay')}</button>}
              </div>
              {paying === p.id && (
                <form noValidate aria-label={t('ap.payFor', { number: p.number })} className={ui.formCard} onSubmit={(e) => void confirm(e, p)}>
                  <fieldset className={ui.field}><legend>{t('ap.field.method')}</legend>
                    <div className={ui.chips}>{METHODS.map((m) => <button key={m} type="button" className={method === m ? ui.chipOn : ui.chip} aria-pressed={method === m} onClick={() => setMethod(m)}>{t(`ap.method.${m}` as 'ap.method.cash')}</button>)}</div>
                  </fieldset>
                  <label className={ui.field}><span>{t('ap.field.reference')}</span><input type="text" autoComplete="off" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
                  {formError && <p className={ui.err} role="alert">{formError}</p>}
                  <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{t('ap.confirm')}</button><button type="button" className={ui.btnGhost} onClick={() => setPaying(null)}>{t('ap.cancel')}</button></div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
