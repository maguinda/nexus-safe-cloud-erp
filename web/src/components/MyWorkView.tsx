import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatDay } from '../lib/format';
import { dueChip } from '../lib/invoice-table';
import { filterOrders, isActive, loadTone, myList, orderDue, summarize, type OrderFilter } from '../lib/mywork';
import type { MyCapacity, WorkOrder } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { Checklist, type CheckItem } from './shared/Checklist';
import { ProgressBar } from './shared/ProgressBar';
import { StatusChip, type Tone } from './shared/StatusChip';
import { KpiCard } from './KpiCard';
import { MyActivities } from './MyActivities';
import { MyMilestones } from './MyMilestones';
import s from './MyWorkView.module.css';

const FILTERS: OrderFilter[] = ['todo', 'doing', 'done', 'all'];
const PRIORITY_TONE: Record<WorkOrder['priority'], Tone> = { critical: 'bad', high: 'warn', normal: 'neutral', low: 'neutral' };

/** Mi trabajo (ingeniero y técnico): solo lo mío. Mi carga con semáforo, mi avance, una lista de lo hecho / en curso / por hacer y mis órdenes en una tabla. Nunca sueldos, costos ni lo de otras personas. */
export function MyWorkView({ toast }: { toast: (m: string) => void }) {
  const { api, t, lang, user } = useSession();
  const alive = useAlive();
  const [cap, setCap] = useState<MyCapacity | null>(null);
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [error, setError] = useState('');
  const [finishing, setFinishing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [selId, setSelId] = useState<string | null>(null);
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

  /** El formulario de «terminar» con su nota: el mismo en la tabla de órdenes y en el detalle de una asignación. */
  const finishForm = (o: WorkOrder) => (
    <form noValidate aria-label={t('mw.finishFor', { n: o.number })} className={s.finishForm} onSubmit={(e) => finish(e, o)}>
      <label className={ui.field}><span>{t('mw.note')}</span><input type="text" autoComplete="off" maxLength={320} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!noteError} />{noteError && <span className={ui.err} role="alert">{noteError}</span>}</label>
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={!!busy}>{t('mw.confirm')}</button><button type="button" className={ui.btnGhost} onClick={() => setFinishing(null)}>{t('mw.cancel')}</button></div>
    </form>
  );
  const day = (d: string) => formatDay(`${d}T00:00:00Z`, lang);
  const now = Date.now();
  const sum = useMemo(() => summarize(orders ?? [], Date.now()), [orders]);
  const list = useMemo(() => myList(orders ?? [], Date.now()), [orders]);
  const shown = useMemo(() => filterOrders(orders ?? [], filter, Date.now()), [orders, filter]);
  const sel = cap?.me.allocations.find((a) => a.id === selId) ?? null;
  const selOrder = sel?.kind === 'maintenance' ? (orders ?? []).find((o) => o.id === sel.workOrderId) ?? null : null;
  const counts: Record<OrderFilter, number> = { todo: sum.todo, doing: sum.doing, done: sum.done, all: sum.total };

  const dueCell = (o: WorkOrder) => {
    if (o.status === 'done') return <span className={ui.muted}>{o.closedAt ? t('mw.closedOn', { date: formatDay(o.closedAt, lang) }) : t('mw.state.done')}</span>;
    const due = orderDue(o, now);
    const chip = dueChip(due, t);
    return (
      <span className={s.dueCell}>
        {o.dueDate ? <span className={ui.muted}>{day(o.dueDate)}</span> : <span className={ui.muted}>{t('mw.due.none')}</span>}
        {chip && <StatusChip tone={due.state === 'overdue' ? 'bad' : 'warn'}>{chip}</StatusChip>}
      </span>
    );
  };

  const items: CheckItem[] = list.map(({ order: o, state }) => {
    const due = orderDue(o, now);
    const chip = dueChip(due, t);
    return {
      key: o.id, state,
      label: <><strong>{o.number}</strong> · {o.targetName}</>,
      detail: t(`wo.type.${o.type}` as 'wo.type.inspection'),
      trailing: o.status === 'done' ? <span className={ui.muted}>{o.closedAt ? formatDay(o.closedAt, lang) : ''}</span> : chip ? <StatusChip tone={due.state === 'overdue' ? 'bad' : 'warn'}>{chip}</StatusChip> : null,
    };
  });

  const loadPct = cap?.me.loadToday ?? 0;
  const tone = loadTone(loadPct);
  const peakTone = loadTone(cap?.me.peakNext30 ?? 0);

  return (
    <section aria-labelledby="mw-h" className={s.stack}>
      <h2 id="mw-h" className={ui.h2}>{t('mw.title')}</h2>
      <p className={ui.muted}>{t('mw.intro')}</p>
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {(cap === null || orders === null) && !error ? <p role="status" className={ui.muted}>{t('mw.loading')}</p> : cap && orders && (
        <>
          <div className={ui.kpis}>
            <KpiCard label={t('mw.kpi.todo')} value={sum.todo} icon="hourglass" sub={t('mw.kpi.ofTotal', { total: sum.total })} />
            <KpiCard label={t('mw.kpi.doing')} value={sum.doing} icon="clock" tone={sum.doing > 0 ? 'warn' : undefined} />
            <KpiCard label={t('mw.kpi.overdue')} value={sum.overdue} icon={sum.overdue > 0 ? 'alert' : 'check'} tone={sum.overdue > 0 ? 'bad' : 'ok'} sub={sum.overdue === 0 ? t('mw.kpi.none') : undefined} />
            <KpiCard label={t('mw.kpi.done')} value={sum.done} icon="check" tone={sum.done > 0 ? 'ok' : undefined} />
          </div>

          <div className={s.top}>
            <section className={s.panel} aria-labelledby="mw-load-h">
              <div className={s.panelHead}>
                <h3 id="mw-load-h" className={s.panelTitle}>{t('mw.load.title')}</h3>
                <StatusChip tone={tone}>{t(`mw.tone.${tone}` as 'mw.tone.ok')}</StatusChip>
              </div>
              <p className={s.lead} data-mw-load>{t('mw.load', { load: cap.me.loadToday, free: cap.me.freeToday, peak: cap.me.peakNext30 })}</p>
              <ProgressBar value={Math.min(loadPct, 100)} tone={tone} label={t('mw.load.bar')} caption={t('mw.load.barCaption', { load: cap.me.loadToday, free: cap.me.freeToday })} />
              <div><StatusChip tone={peakTone}>{t('mw.load.peak', { peak: cap.me.peakNext30 })}</StatusChip></div>
            </section>
            <section className={s.panel} aria-labelledby="mw-prog-h">
              <h3 id="mw-prog-h" className={s.panelTitle}>{t('mw.progress.title')}</h3>
              {sum.total === 0 ? <p className={ui.muted}>{t('mw.progress.empty')}</p> : (
                <ProgressBar value={sum.done} max={sum.total} tone={sum.done === sum.total ? 'ok' : undefined} label={t('mw.progress.bar')} caption={t('mw.progress.caption', { done: sum.done, total: sum.total })} />
              )}
              <h4 className={s.panelTitle}>{t('mw.list.title')}</h4>
              {items.length === 0 ? <p className={ui.muted}>{t('mw.list.empty')}</p> : (
                <Checklist items={items} ariaLabel={t('mw.list.label')} labels={{ done: t('mw.state.done'), doing: t('mw.state.doing'), todo: t('mw.state.todo'), bad: t('mw.state.bad') }} />
              )}
            </section>
          </div>

          <section aria-labelledby="mw-alloc-h" className={s.stack}>
            <h3 id="mw-alloc-h" className={ui.h2}>{t('mw.allocations')}</h3>
            {cap.me.allocations.length === 0 ? <p className={ui.muted}>{t('mw.noAllocations')}</p> : (
              <div className={ui.scroll}>
                <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
                  <caption className={s.sr}>{t('mw.alloc.caption')}</caption>
                  <thead><tr><th>{t('mw.acol.kind')}</th><th>{t('mw.acol.name')}</th><th>{t('mw.acol.percent')}</th><th>{t('mw.acol.from')}</th><th>{t('mw.acol.to')}</th><th>{t('mw.col.pick')}</th></tr></thead>
                  <tbody>
                    {cap.me.allocations.map((a) => (
                      <tr key={a.id} data-kind={a.kind} data-selected={a.id === selId ? 'true' : undefined} className={a.id === selId ? s.selectedRow : undefined}>
                        <td data-label={t('mw.acol.kind')}><StatusChip tone={a.kind === 'maintenance' ? 'info' : 'neutral'} icon={a.kind === 'maintenance' ? 'clock' : 'layers'}>{t(a.kind === 'maintenance' ? 'mw.kind.maintenance' : 'mw.kind.project')}</StatusChip></td>
                        <td data-label={t('mw.acol.name')}><span className={s.what}>{a.projectName}</span></td>
                        <td data-label={t('mw.acol.percent')}>
                          <span className={s.mini}>
                            <ProgressBar value={Math.min(a.percent, 100)} tone={a.overAllocated ? 'bad' : loadTone(a.percent)} label={t('mw.acol.percent')} caption={`${a.percent} %`} />
                            {a.overAllocated && <StatusChip tone="bad">{t('mw.over')}</StatusChip>}
                          </span>
                        </td>
                        <td data-label={t('mw.acol.from')} className={ui.muted}>{day(a.startDate)}</td>
                        <td data-label={t('mw.acol.to')} className={ui.muted}>{day(a.endDate)}</td>
                        <td data-label={t('mw.col.pick')}><button type="button" className={a.id === selId ? ui.btn : ui.btnGhost} aria-pressed={a.id === selId} aria-label={t('mw.sel.select', { name: a.projectName })} onClick={() => setSelId(a.id === selId ? null : a.id)}>{t('mw.col.pick')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cap.me.allocations.length > 0 && (
              <section className={s.panel} aria-labelledby="mw-sel-h" aria-live="polite" data-selection={sel ? sel.kind : 'none'}>
                <div className={s.panelHead}><h4 id="mw-sel-h" className={s.panelTitle}>{t('mw.sel.title')}</h4>{sel && <button type="button" className={ui.btnGhost} onClick={() => setSelId(null)}>{t('mw.sel.clear')}</button>}</div>
                {!sel && <p className={ui.muted}>{t('mw.sel.hint')}</p>}
                {sel && <p className={s.lead}>{sel.projectName} · {sel.percent} % · {day(sel.startDate)} – {day(sel.endDate)}</p>}
                {sel?.kind === 'project' && <p className={ui.muted}>{t('mw.sel.project', { project: sel.projectName })}</p>}
                {sel?.kind === 'maintenance' && <p className={ui.muted}>{t('mw.sel.maintenance')}</p>}
                {sel?.kind === 'maintenance' && !selOrder && <p className={ui.muted} role="status">{t('mw.sel.noOrder')}</p>}
                {selOrder && (
                  <div className={s.cell} data-selected-order={selOrder.number}>
                    <span className={s.what}>{selOrder.number} · {t(`wo.type.${selOrder.type}` as 'wo.type.inspection')} · {selOrder.targetName}</span>
                    <span className={s.desc}>{selOrder.description}</span>
                    <span className={s.dueCell}>
                      <StatusChip tone={selOrder.status === 'done' ? 'ok' : selOrder.status === 'in_progress' ? 'info' : 'neutral'} icon={selOrder.status === 'done' ? 'check' : selOrder.status === 'in_progress' ? 'clock' : 'hourglass'}>{t(`wo.status.${selOrder.status}` as 'wo.status.open')}</StatusChip>
                      {dueCell(selOrder)}
                    </span>
                    {isActive(selOrder) && (
                      <span className={s.rowActions}>
                        {selOrder.status === 'open' && <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('mw.startFor', { n: selOrder.number })} onClick={() => void act(`s:${selOrder.id}`, async () => { const r = await api.progressOrder(selOrder.id, 'in_progress'); return t('mw.started', { n: r.number }); })}>{t('mw.start')}</button>}
                        {finishing !== selOrder.id && <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('mw.finishFor', { n: selOrder.number })} onClick={() => { setFinishing(selOrder.id); setNote(''); setNoteError(''); }}>{t('mw.finish')}</button>}
                      </span>
                    )}
                    {finishing === selOrder.id && finishForm(selOrder)}
                  </div>
                )}
              </section>
            )}
          </section>

          {user?.role === 'engineer' && <MyMilestones project={sel?.kind === 'project' ? sel.projectName : null} onClearProject={() => setSelId(null)} toast={toast} />}
          {user?.role === 'technician' && <MyActivities toast={toast} />}

          <section aria-labelledby="mw-ord-h" className={s.stack}>
            <h3 id="mw-ord-h" className={ui.h2}>{t('mw.orders')}</h3>
            {orders.length === 0 ? <p className={ui.muted}>{t('mw.noOrders')}</p> : (
              <>
                <div className={`${ui.seg} ${s.seg}`} role="group" aria-label={t('mw.filter.label')}>
                  {FILTERS.map((f) => <button key={f} type="button" className={filter === f ? ui.segBtnOn : ui.segBtn} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`mw.filter.${f}` as 'mw.filter.all')} ({counts[f]})</button>)}
                </div>
                {shown.length === 0 ? <div className={s.empty} role="status">{t('mw.noMatch')}</div> : (
                  <div className={ui.scroll}>
                    <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
                      <caption className={s.sr}>{t('mw.caption')}</caption>
                      <thead><tr><th>{t('mw.col.number')}</th><th>{t('mw.col.target')}</th><th>{t('mw.col.priority')}</th><th>{t('mw.col.status')}</th><th>{t('mw.col.due')}</th><th>{t('mw.col.capacity')}</th><th>{t('mw.col.action')}</th></tr></thead>
                      <tbody>
                        {shown.flatMap((o) => {
                          const row = (
                            <tr key={o.id} data-order={o.number} data-status={o.status}>
                              <td className={s.number}>{o.number}</td>
                              <td data-label={t('mw.col.target')}>
                                <span className={s.cell}><span className={s.what}>{t(`wo.type.${o.type}` as 'wo.type.inspection')} · {o.targetName}</span><span className={s.desc}>{o.description}</span></span>
                              </td>
                              <td data-label={t('mw.col.priority')}><StatusChip tone={PRIORITY_TONE[o.priority]} icon={o.priority === 'critical' ? 'alert' : o.priority === 'high' ? 'warning' : null}>{t(`wo.priority.${o.priority}` as 'wo.priority.low')}</StatusChip></td>
                              <td data-label={t('mw.col.status')}><StatusChip tone={o.status === 'done' ? 'ok' : o.status === 'in_progress' ? 'info' : 'neutral'} icon={o.status === 'done' ? 'check' : o.status === 'in_progress' ? 'clock' : 'hourglass'}>{t(`wo.status.${o.status}` as 'wo.status.open')}</StatusChip></td>
                              <td data-label={t('mw.col.due')}>{dueCell(o)}</td>
                              <td data-label={t('mw.col.capacity')} className={ui.muted}>{o.capacityPercent && o.capacityStart && o.capacityEnd ? t('mw.order.cap', { percent: o.capacityPercent, from: day(o.capacityStart), to: day(o.capacityEnd) }) : t('mw.cap.none')}</td>
                              <td data-label={t('mw.col.action')}>
                                {isActive(o) ? (
                                  <span className={s.rowActions}>
                                    {o.status === 'open' && <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('mw.startFor', { n: o.number })} onClick={() => void act(`s:${o.id}`, async () => { const r = await api.progressOrder(o.id, 'in_progress'); return t('mw.started', { n: r.number }); })}>{t('mw.start')}</button>}
                                    {finishing !== o.id && <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('mw.finishFor', { n: o.number })} onClick={() => { setFinishing(o.id); setNote(''); setNoteError(''); }}>{t('mw.finish')}</button>}
                                  </span>
                                ) : <span className={ui.muted}>—</span>}
                              </td>
                            </tr>
                          );
                          if (finishing !== o.id || selOrder?.id === o.id) return [row];
                          return [row, (
                            <tr key={`${o.id}-f`} className={s.finishRow}>
                              <td colSpan={7}>
                                {finishForm(o)}
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
        </>
      )}
    </section>
  );
}
