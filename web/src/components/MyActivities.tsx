import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { activityDue, filterActivities, summarizeActivities, type ActivityFilter } from '../lib/activities';
import { formatDay } from '../lib/format';
import { dueChip } from '../lib/invoice-table';
import type { MyActivity } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { KpiCard } from './KpiCard';
import { ProgressBar } from './shared/ProgressBar';
import { StatusChip } from './shared/StatusChip';
import s from './MyWorkView.module.css';

const FILTERS: ActivityFilter[] = ['todo', 'doing', 'done', 'all'];

/** Mis actividades (técnico): solo las que le asignó el ingeniero responsable de cada hito. Las inicia y las termina con una nota opcional. */
export function MyActivities({ toast }: { toast: (m: string) => void }) {
  const { api, t, lang } = useSession();
  const alive = useAlive();
  const [list, setList] = useState<MyActivity[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [finishing, setFinishing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [busy, setBusy] = useState('');
  const inflight = useRef(false);

  const load = useCallback(async () => {
    try { const r = await api.myActivities(); if (alive.current) { setList(r); setError(''); } } catch (e) { if (alive.current) setError(t('act.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, work: () => Promise<string>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(key);
    try { toast(await work()); await load(); } catch (e) { toast(t('act.failed', { reason: errorText(e, t, 'server.unexpected') })); } finally { inflight.current = false; if (alive.current) setBusy(''); }
  }
  function finish(e: FormEvent, a: MyActivity) {
    e.preventDefault();
    const n = note.replace(/\s+/g, ' ').trim();
    // eslint-disable-next-line no-control-regex
    if (n.length > 300 || /[<>\u0000-\u001f]/.test(n)) { setNoteError(t('act.v.note')); return; }
    setNoteError('');
    void act(`d:${a.id}`, async () => { const r = await api.progressActivity(a.id, 'done', n || undefined); setFinishing(null); return t('act.done', { code: r.code }); });
  }

  const now = Date.now();
  const sum = useMemo(() => summarizeActivities(list ?? [], Date.now()), [list]);
  const shown = useMemo(() => filterActivities(list ?? [], filter, Date.now()), [list, filter]);
  const counts: Record<ActivityFilter, number> = { todo: sum.todo, doing: sum.doing, done: sum.done, all: sum.total };
  const day = (d: string) => formatDay(`${d}T00:00:00Z`, lang);

  return (
    <section aria-labelledby="act-h" className={s.stack}>
      <h3 id="act-h" className={ui.h2}>{t('act.title')}</h3>
      <p className={ui.muted}>{t('act.intro')}</p>
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {list === null && !error ? <p role="status" className={ui.muted}>{t('act.loading')}</p> : list && (list.length === 0 ? <div className={s.empty} role="status">{t('act.empty')}</div> : (
        <>
          <div className={ui.kpis}>
            <KpiCard label={t('act.kpi.todo')} value={sum.todo} icon="hourglass" />
            <KpiCard label={t('act.kpi.doing')} value={sum.doing} icon="clock" tone={sum.doing > 0 ? 'warn' : undefined} />
            <KpiCard label={t('act.kpi.overdue')} value={sum.overdue} icon={sum.overdue > 0 ? 'alert' : 'check'} tone={sum.overdue > 0 ? 'bad' : 'ok'} />
            <KpiCard label={t('act.kpi.done')} value={sum.done} icon="check" tone={sum.done > 0 ? 'ok' : undefined} />
          </div>
          <ProgressBar value={sum.done} max={Math.max(1, sum.total)} tone={sum.total > 0 && sum.done === sum.total ? 'ok' : undefined} label={t('act.progress')} caption={t('act.progress.caption', { done: sum.done, total: sum.total })} />
          <div className={`${ui.seg} ${s.seg}`} role="group" aria-label={t('act.filter.label')}>
            {FILTERS.map((f) => <button key={f} type="button" className={filter === f ? ui.segBtnOn : ui.segBtn} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`act.filter.${f}` as 'act.filter.all')} ({counts[f]})</button>)}
          </div>
          {shown.length === 0 ? <div className={s.empty} role="status">{t('act.noMatch')}</div> : (
            <div className={ui.scroll}>
              <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
                <caption className={s.sr}>{t('act.caption')}</caption>
                <thead><tr><th>{t('act.col.code')}</th><th>{t('act.col.what')}</th><th>{t('act.col.where')}</th><th>{t('act.col.due')}</th><th>{t('act.col.status')}</th><th>{t('act.col.action')}</th></tr></thead>
                <tbody>
                  {shown.flatMap((a) => {
                    const due = activityDue(a, now);
                    const chip = dueChip(due, t);
                    const live = a.status === 'open' || a.status === 'in_progress';
                    const row = (
                      <tr key={a.id} data-activity={a.code} data-status={a.status}>
                        <td className={s.number}>{a.code}</td>
                        <td data-label={t('act.col.what')}><span className={s.cell}><span className={s.what}>{a.title}</span>{a.description && <span className={s.desc}>{a.description}</span>}{a.doneNote && <span className={s.desc}>{a.doneNote}</span>}</span></td>
                        <td data-label={t('act.col.where')} className={ui.muted}>{t('act.hito', { milestone: a.milestoneName, project: a.projectName })}</td>
                        <td data-label={t('act.col.due')}>
                          {a.status === 'done' ? <span className={ui.muted}>{a.doneAt ? t('act.closedOn', { date: formatDay(a.doneAt, lang) }) : t('act.status.done')}</span> : (
                            <span className={s.dueCell}>{a.dueDate ? <span className={ui.muted}>{day(a.dueDate)}</span> : <span className={ui.muted}>{t('act.due.none')}</span>}{chip && <StatusChip tone={due.state === 'overdue' ? 'bad' : 'warn'}>{chip}</StatusChip>}</span>
                          )}
                        </td>
                        <td data-label={t('act.col.status')}><StatusChip tone={a.status === 'done' ? 'ok' : a.status === 'in_progress' ? 'info' : 'neutral'} icon={a.status === 'done' ? 'check' : a.status === 'in_progress' ? 'clock' : 'hourglass'}>{t(`act.status.${a.status}` as 'act.status.open')}</StatusChip></td>
                        <td data-label={t('act.col.action')}>
                          {live ? (
                            <span className={s.rowActions}>
                              {a.status === 'open' && <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('act.startFor', { code: a.code })} onClick={() => void act(`s:${a.id}`, async () => { const r = await api.progressActivity(a.id, 'in_progress'); return t('act.started', { code: r.code }); })}>{t('act.start')}</button>}
                              {finishing !== a.id && <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('act.finishFor', { code: a.code })} onClick={() => { setFinishing(a.id); setNote(''); setNoteError(''); }}>{t('act.finish')}</button>}
                            </span>
                          ) : <span className={ui.muted}>—</span>}
                        </td>
                      </tr>
                    );
                    if (finishing !== a.id) return [row];
                    return [row, (
                      <tr key={`${a.id}-f`} className={s.finishRow}>
                        <td colSpan={6}>
                          <form noValidate aria-label={t('act.finishFor', { code: a.code })} className={s.finishForm} onSubmit={(e) => finish(e, a)}>
                            <label className={ui.field}><span>{t('act.note')}</span><input type="text" autoComplete="off" maxLength={320} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!noteError} />{noteError && <span className={ui.err} role="alert">{noteError}</span>}</label>
                            <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={!!busy}>{t('act.confirm')}</button><button type="button" className={ui.btnGhost} onClick={() => setFinishing(null)}>{t('act.cancel')}</button></div>
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
      ))}
    </section>
  );
}
