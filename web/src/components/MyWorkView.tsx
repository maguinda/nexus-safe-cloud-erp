import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatDay } from '../lib/format';
import type { MyCapacity, WorkOrder } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './QuotesView.module.css';

/** Mi trabajo (ingeniero y técnico): solo lo mío. Mi carga, mis asignaciones y mis órdenes de trabajo, que puedo iniciar y terminar. Nunca sueldos, costos ni lo de otras personas. */
export function MyWorkView({ toast }: { toast: (m: string) => void }) {
  const { api, t, lang } = useSession();
  const alive = useAlive();
  const [cap, setCap] = useState<MyCapacity | null>(null);
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [error, setError] = useState('');
  const [finishing, setFinishing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [busy, setBusy] = useState('');
  const inflight = useRef(false);

  const load = useCallback(async () => {
    try { const [c, o] = await Promise.all([api.myCapacity(), api.myOrders()]); if (alive.current) { setCap(c); setOrders(o); setError(''); } } catch (e) { if (alive.current) setError(t('mw.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, work: () => Promise<string>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(key);
    try { toast(await work()); await load(); } catch (e) { toast(t('mw.failed', { reason: errorText(e, t, 'server.unexpected') })); } finally { inflight.current = false; if (alive.current) setBusy(''); }
  }

  function finish(e: FormEvent, o: WorkOrder) {
    e.preventDefault();
    const n = note.replace(/\s+/g, ' ').trim();
    // eslint-disable-next-line no-control-regex
    if (n.length > 300 || /[\u0000-\u001f<>]/.test(n)) { setNoteError(t('mw.v.note')); return; }
    setNoteError('');
    void act(`d:${o.id}`, async () => { const r = await api.progressOrder(o.id, 'done', n || undefined); setFinishing(null); return t('mw.done', { n: r.number }); });
  }

  const day = (d: string) => formatDay(`${d}T00:00:00Z`, lang);
  const active = (o: WorkOrder) => o.status === 'open' || o.status === 'in_progress';

  return (
    <section aria-labelledby="mw-h" className={s.stack}>
      <h2 id="mw-h" className={ui.h2}>{t('mw.title')}</h2>
      <p className={ui.muted}>{t('mw.intro')}</p>
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {cap === null && !error ? <p role="status" className={ui.muted}>{t('mw.loading')}</p> : cap && (
        <>
          <p className={s.total} data-mw-load>{t('mw.load', { load: cap.me.loadToday, free: cap.me.freeToday, peak: cap.me.peakNext30 })}</p>
          <h3 className={ui.h2}>{t('mw.allocations')}</h3>
          {cap.me.allocations.length === 0 ? <p className={ui.muted}>{t('mw.noAllocations')}</p> : (
            <ul className={s.rates}>
              {cap.me.allocations.map((a) => <li key={a.id} className={s.rate} data-kind={a.kind}>{t(a.kind === 'maintenance' ? 'mw.alloc.maintenance' : 'mw.alloc', { project: a.projectName, percent: a.percent, from: day(a.startDate), to: day(a.endDate) })}</li>)}
            </ul>
          )}
        </>
      )}
      <h3 className={ui.h2}>{t('mw.orders')}</h3>
      {orders !== null && (orders.length === 0 ? <p className={ui.muted}>{t('mw.noOrders')}</p> : (
        <ul className={s.list}>
          {orders.map((o) => (
            <li key={o.id} className={s.card} data-order={o.number} data-status={o.status}>
              <div className={s.head}>
                <div>
                  <h3 className={s.title}>{t('mw.order.line', { number: o.number, type: t(`wo.type.${o.type}` as 'wo.type.inspection'), target: o.targetName, description: o.description })} <span className={active(o) ? s.badgeWarn : s.badgeOk}>{t(`wo.status.${o.status}` as 'wo.status.open')}</span></h3>
                  <span className={s.note}>{o.dueDate ? t('mw.order.due', { date: day(o.dueDate) }) : ''}{o.capacityPercent && o.capacityStart && o.capacityEnd ? `${o.dueDate ? ' · ' : ''}${t('mw.order.cap', { percent: o.capacityPercent, from: day(o.capacityStart), to: day(o.capacityEnd) })}` : ''}</span>
                </div>
                {active(o) && (
                  <div className={s.actions}>
                    {o.status === 'open' && <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('mw.startFor', { n: o.number })} onClick={() => void act(`s:${o.id}`, async () => { const r = await api.progressOrder(o.id, 'in_progress'); return t('mw.started', { n: r.number }); })}>{t('mw.start')}</button>}
                    {finishing !== o.id && <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('mw.finishFor', { n: o.number })} onClick={() => { setFinishing(o.id); setNote(''); setNoteError(''); }}>{t('mw.finish')}</button>}
                  </div>
                )}
              </div>
              {finishing === o.id && (
                <form noValidate aria-label={t('mw.finishFor', { n: o.number })} className={ui.formCard} onSubmit={(e) => finish(e, o)}>
                  <label className={ui.field}><span>{t('mw.note')}</span><input type="text" autoComplete="off" maxLength={320} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!noteError} />{noteError && <span className={ui.err}>{noteError}</span>}</label>
                  <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={!!busy}>{t('mw.confirm')}</button><button type="button" className={ui.btnGhost} onClick={() => setFinishing(null)}>{t('mw.cancel')}</button></div>
                </form>
              )}
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
