import { useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatInstant } from '../lib/format';
import type { WorkOrder, WorkOrderLogLine } from '../lib/types';
import { StaffPicker, type StaffChoice } from './StaffPicker';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './WorkOrdersView.module.css';

type Filter = 'active' | 'all' | 'open' | 'in_progress' | 'done' | 'cancelled';
const FILTERS: Filter[] = ['active', 'open', 'in_progress', 'done', 'cancelled', 'all'];

/** Órdenes de trabajo: gerencia las crea (desde Sensores y Red), las inicia, las cierra o las cancela; el líder de proyecto solo las ve. */
export function WorkOrdersView({ toast }: { toast: (m: string) => void }) {
  const { api, user, t, lang } = useSession();
  const alive = useAlive();
  const isManager = user?.role === 'manager';
  const [rows, setRows] = useState<WorkOrder[] | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [log, setLog] = useState<WorkOrderLogLine[] | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [who, setWho] = useState<StaffChoice | null>(null);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    try { const r = await api.workOrders(filter === 'all' || filter === 'active' ? undefined : filter); if (alive.current) { setRows(filter === 'active' ? r.filter((o) => o.status === 'open' || o.status === 'in_progress') : r); setError(''); } }
    catch (e) { if (alive.current) setError(t('wo.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, filter, t]);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, work: () => Promise<string>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(key);
    try { toast(await work()); } catch (e) { toast(t('wo.failed', { reason: errorText(e, t, 'server.unexpected') })); }
    finally { inflight.current = false; setBusy(''); await load(); }
  }
  const status = (o: WorkOrder, to: 'in_progress' | 'done' | 'cancelled') => act(`${o.id}:${to}`, async () => { const r = await api.setWorkOrderStatus(o.id, to); return t('wo.changed', { n: r.number, status: t(`wo.status.${r.status}` as 'wo.status.open') }); });
  async function history(o: WorkOrder) {
    if (open === o.id) { setOpen(null); return; }
    setOpen(o.id); setLog(null);
    try { setLog((await api.workOrder(o.id)).log); } catch { setLog([]); }
  }
  const day = (iso: string) => formatInstant(iso, lang);

  return (
    <section aria-labelledby="wo-h">
      <h2 id="wo-h" className={ui.h2}>{t('wo.title')}</h2>
      <p className={ui.muted}>{t('wo.intro')}</p>
      {error && <p className={ui.panelError} role="alert">{error}</p>}
      <div className={s.filters} role="group" aria-label={t('wo.filter')}>
        {FILTERS.map((x) => <button key={x} type="button" className={filter === x ? ui.segBtnOn : ui.segBtn} aria-pressed={filter === x} onClick={() => setFilter(x)}>{x === 'all' ? t('wo.filter.all') : x === 'active' ? t('wo.filter.active') : t(`wo.status.${x}` as 'wo.status.open')}</button>)}
      </div>
      {rows === null ? <p className={ui.muted} role="status">…</p> : rows.length === 0 ? <p className={ui.muted}>{t('wo.empty')}</p> : (
        <ul className={s.list}>
          {rows.map((o) => {
            const active = o.status === 'open' || o.status === 'in_progress';
            return (
              <li key={o.id} className={`${ui.formCard} ${s.card}`} data-order={o.number} data-status={o.status}>
                <div className={s.head}>
                  <strong>{o.number}</strong> · {t(`wo.type.${o.type}` as 'wo.type.inspection')} · <span>{t(`wo.priority.${o.priority}` as 'wo.priority.low')}</span>
                  <span className={active ? ui.pending : ui.approved}>{t(`wo.status.${o.status}` as 'wo.status.open')}</span>
                </div>
                <p><strong>{o.targetName}</strong> — {o.description}</p>
                {o.sourceNote && <p className={ui.muted}>{t('wo.origin', { note: o.sourceNote })}</p>}
                <p className={ui.muted}>
                  {o.assignedTo ? t('wo.col.assigned', { name: o.assignedTo }) : t('wo.noAssigned')}{o.dueDate ? ` · ${t('wo.col.due', { date: o.dueDate })}` : ''} · {t('wo.by', { who: o.createdBy ?? '—', date: day(o.createdAt) })}
                </p>
                <div className={s.actions}>
                  {isManager && o.status === 'open' && <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('wo.startFor', { n: o.number })} onClick={() => void status(o, 'in_progress')}>{t('wo.start')}</button>}
                  {isManager && active && <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('wo.markDoneFor', { n: o.number })} onClick={() => void status(o, 'done')}>{t('wo.markDone')}</button>}
                  {isManager && active && <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('wo.cancelOrderFor', { n: o.number })} onClick={() => void status(o, 'cancelled')}>{t('wo.cancelOrder')}</button>}
                  {isManager && active && assigning !== o.id && <button type="button" className={ui.btnGhost} aria-label={t('wo.assignFor', { n: o.number })} onClick={() => { setAssigning(o.id); setWho(o.assignedToId && o.assignedTo ? { id: o.assignedToId, name: o.assignedTo } : null); }}>{t('wo.assign')}</button>}
                  <button type="button" className={ui.btnGhost} aria-expanded={open === o.id} aria-label={t('wo.historyFor', { n: o.number })} onClick={() => void history(o)}>{open === o.id ? t('wo.hide') : t('wo.history')}</button>
                </div>
                {assigning === o.id && (
                  <form className={s.assign} noValidate onSubmit={(e) => { e.preventDefault(); void act(`${o.id}:assign`, async () => { const r = await api.assignWorkOrder(o.id, who?.name ?? '', who?.id); setAssigning(null); return t('wo.changed', { n: r.number, status: r.assignedTo ?? t('wo.noAssigned') }); }); }}>
                    <StaffPicker label={t('wo.assignField', { n: o.number })} value={who} onChange={setWho} />
                    <button type="submit" className={ui.btn} disabled={!!busy}>{t('wo.assignSave')}</button>
                    <button type="button" className={ui.btnGhost} onClick={() => setAssigning(null)}>{t('wo.cancel')}</button>
                  </form>
                )}
                {open === o.id && (log === null ? <p className={ui.muted} role="status">…</p> : (
                  <ul className={s.log}>{log.map((l, i) => <li key={i}>{t('wo.logLine', { date: day(l.at), status: t(`wo.status.${l.to}` as 'wo.status.open'), who: l.actor ?? '—', note: l.note ? ` · ${l.note}` : '' })}</li>)}</ul>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
