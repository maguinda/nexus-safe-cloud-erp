import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { activityDue, sameProject, validateActivity } from '../lib/activities';
import { formatDay } from '../lib/format';
import { dueChip } from '../lib/invoice-table';
import type { MilestoneActivity, MyMilestone, TechnicianOption } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { ProgressBar } from './shared/ProgressBar';
import { StatusChip } from './shared/StatusChip';
import s from './MyWorkView.module.css';

interface Props { project: string | null; onClearProject: () => void; toast: (m: string) => void }

/** Elegir al técnico con botones (con su carga de hoy); tocar de nuevo al elegido lo quita. */
function TechPicker({ techs, error, value, onChange, label }: { techs: TechnicianOption[] | null; error: string; value: TechnicianOption | null; onChange: (v: TechnicianOption | null) => void; label: string }) {
  const { t } = useSession();
  return (
    <fieldset className={`${ui.field} ${ui.fieldWide}`}>
      <legend>{label}</legend>
      {techs === null && !error && <p className={ui.muted} role="status">{t('ms.tech.loading')}</p>}
      {error && <p className={ui.err} role="alert">{t('ms.tech.error', { reason: error })}</p>}
      {techs !== null && (
        <div className={ui.chips}>
          {techs.map((p) => (
            <button key={p.id} type="button" className={value?.id === p.id ? ui.chipOn : ui.chip} aria-pressed={value?.id === p.id} onClick={() => onChange(value?.id === p.id ? null : p)}>
              {p.name} · {t('ms.tech.load', { pct: p.loadToday })}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Mis hitos (ingeniero): los hitos de los que es responsable, con el avance de sus actividades. Aquí crea las actividades, se las asigna a un técnico, las reasigna o las cancela. */
export function MyMilestones({ project, onClearProject, toast }: Props) {
  const { api, t, lang } = useSession();
  const alive = useAlive();
  const [list, setList] = useState<MyMilestone[] | null>(null);
  const [error, setError] = useState('');
  const [techs, setTechs] = useState<TechnicianOption[] | null>(null);
  const [techError, setTechError] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', description: '', due: '' });
  const [tech, setTech] = useState<TechnicianOption | null>(null);
  const [errs, setErrs] = useState<ReturnType<typeof validateActivity>>({});
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [newTech, setNewTech] = useState<TechnicianOption | null>(null);
  const [busy, setBusy] = useState('');
  const inflight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { const r = await api.myMilestones(); if (alive.current) { setList(r); setError(''); } } catch (e) { if (alive.current) setError(t('ms.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  const needTechs = adding !== null || reassigning !== null;
  useEffect(() => {
    if (!needTechs || techs !== null) return;
    api.technicians().then((r) => { if (alive.current) setTechs(r); }).catch((e) => { if (alive.current) setTechError(errorText(e, t, 'server.unexpected')); });
  }, [needTechs, techs, api, alive, t]);
  useEffect(() => { if (adding) titleRef.current?.focus(); }, [adding]);

  async function act(key: string, work: () => Promise<string>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(key);
    try { toast(await work()); await load(); } catch (e) { toast(t('ms.failed', { reason: errorText(e, t, 'server.unexpected') })); } finally { inflight.current = false; if (alive.current) setBusy(''); }
  }

  function create(e: FormEvent, m: MyMilestone) {
    e.preventDefault();
    const today = new Date().toISOString().slice(0, 10);
    const v = validateActivity({ ...form, tech: tech?.id ?? null }, today);
    setErrs(v);
    if (Object.keys(v).length > 0 || !tech) return;
    const body = { title: form.title.replace(/\s+/g, ' ').trim(), assignedToId: tech.id, assignedTo: tech.name, ...(form.description.trim() ? { description: form.description.replace(/\s+/g, ' ').trim() } : {}), ...(form.due ? { dueDate: form.due } : {}) };
    void act(`c:${m.milestoneId}`, async () => { const r = await api.createActivity(m.milestoneId, body); setAdding(null); return t('ms.created', { code: r.code, tech: tech.name }); });
  }

  const now = Date.now();
  const shown = (list ?? []).filter((m) => !project || sameProject(m.projectName, project));
  const day = (d: string) => formatDay(`${d}T00:00:00Z`, lang);
  const live = (a: MilestoneActivity) => a.status === 'open' || a.status === 'in_progress';

  return (
    <section aria-labelledby="ms-h" className={s.stack}>
      <h3 id="ms-h" className={ui.h2}>{t('ms.title')}</h3>
      <p className={ui.muted}>{t('ms.intro')}</p>
      {project && <div className={s.filterBar} role="status"><span>{t('ms.filtered', { project })}</span><button type="button" className={ui.btnGhost} onClick={onClearProject}>{t('ms.clear')}</button></div>}
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {list === null && !error ? <p role="status" className={ui.muted}>{t('ms.loading')}</p> : list && (list.length === 0 ? <div className={s.empty} role="status">{t('ms.empty')}</div> : shown.length === 0 ? <div className={s.empty} role="status">{t('ms.noneInProject', { project: project ?? '' })}</div> : (
        <div className={s.stack}>
          {shown.map((m) => {
            const open = m.status === 'pending';
            return (
              <article key={m.milestoneId} className={s.panel} data-hito={m.milestoneId} data-status={m.status} aria-label={`${m.name} · ${m.projectName}`}>
                <div className={s.panelHead}>
                  <div className={s.cell}><h4 className={s.panelTitle}>{m.name}</h4><span className={s.desc}>{m.projectName}</span></div>
                  <StatusChip tone={open ? 'warn' : 'ok'} icon={open ? 'clock' : 'check'}>{t(open ? 'ms.status.pending' : 'ms.status.approved')}</StatusChip>
                </div>
                {m.progress.total > 0
                  ? <ProgressBar value={m.progress.done} max={m.progress.total} tone={m.progress.done === m.progress.total ? 'ok' : undefined} label={t('ms.progress')} caption={t('ms.progress.caption', { done: m.progress.done, total: m.progress.total })} />
                  : <p className={ui.muted}>{t('ms.noActivities')}</p>}
                {m.activities.length > 0 && (
                  <div className={ui.scroll}>
                    <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
                      <caption className={s.sr}>{t('ms.caption', { milestone: m.name })}</caption>
                      <thead><tr><th>{t('ms.col.code')}</th><th>{t('ms.col.what')}</th><th>{t('ms.col.tech')}</th><th>{t('ms.col.due')}</th><th>{t('ms.col.status')}</th><th>{t('ms.col.action')}</th></tr></thead>
                      <tbody>
                        {m.activities.flatMap((a) => {
                          const due = activityDue(a, now);
                          const chip = dueChip(due, t);
                          const row = (
                            <tr key={a.id} data-activity={a.code} data-status={a.status}>
                              <td className={s.number}>{a.code}</td>
                              <td data-label={t('ms.col.what')}><span className={s.cell}><span className={s.what}>{a.title}</span>{a.description && <span className={s.desc}>{a.description}</span>}{a.doneNote && <span className={s.desc}>{a.doneNote}</span>}</span></td>
                              <td data-label={t('ms.col.tech')} data-col="tech">{a.assignedTo}</td>
                              <td data-label={t('ms.col.due')}><span className={s.dueCell}>{a.dueDate ? <span className={ui.muted}>{day(a.dueDate)}</span> : <span className={ui.muted}>{t('act.due.none')}</span>}{chip && <StatusChip tone={due.state === 'overdue' ? 'bad' : 'warn'}>{chip}</StatusChip>}</span></td>
                              <td data-label={t('ms.col.status')}><StatusChip tone={a.status === 'done' ? 'ok' : a.status === 'in_progress' ? 'info' : a.status === 'cancelled' ? 'neutral' : 'neutral'} icon={a.status === 'done' ? 'check' : a.status === 'in_progress' ? 'clock' : a.status === 'cancelled' ? 'alert' : 'hourglass'}>{t(`act.status.${a.status}` as 'act.status.open')}</StatusChip></td>
                              <td data-label={t('ms.col.action')}>
                                {live(a) ? (
                                  <span className={s.rowActions}>
                                    {reassigning !== a.id && <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('ms.reassignFor', { code: a.code })} onClick={() => { setReassigning(a.id); setNewTech(null); }}>{t('ms.reassign')}</button>}
                                    <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('ms.cancelActFor', { code: a.code })} onClick={() => void act(`x:${a.id}`, async () => { const r = await api.cancelActivity(a.id); return t('ms.cancelled', { code: r.code }); })}>{t('ms.cancelAct')}</button>
                                  </span>
                                ) : <span className={ui.muted}>—</span>}
                              </td>
                            </tr>
                          );
                          if (reassigning !== a.id) return [row];
                          return [row, (
                            <tr key={`${a.id}-r`} className={s.finishRow}>
                              <td colSpan={6}>
                                <div className={s.finishForm} role="group" aria-label={t('ms.reassignFor', { code: a.code })}>
                                  <TechPicker techs={techs} error={techError} value={newTech} onChange={setNewTech} label={t('ms.f.tech')} />
                                  <div className={ui.formActions}>
                                    <button type="button" className={ui.btn} disabled={!newTech || !!busy} onClick={() => newTech && void act(`r:${a.id}`, async () => { const r = await api.reassignActivity(a.id, newTech.id, newTech.name); setReassigning(null); return t('ms.reassigned', { code: r.code, tech: newTech.name }); })}>{t('ms.reassign.confirm')}</button>
                                    <button type="button" className={ui.btnGhost} onClick={() => setReassigning(null)}>{t('ms.f.cancel')}</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )];
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {!open ? <p className={ui.muted}>{t('ms.approvedNote')}</p> : adding !== m.milestoneId ? (
                  <div><button type="button" className={ui.btn} disabled={!!busy} aria-label={t('ms.addFor', { milestone: m.name })} onClick={() => { setAdding(m.milestoneId); setForm({ title: '', description: '', due: '' }); setTech(null); setErrs({}); }}>{t('ms.add')}</button></div>
                ) : (
                  <form noValidate aria-label={t('ms.addFor', { milestone: m.name })} className={ui.formCard} onSubmit={(e) => create(e, m)}>
                    <label className={ui.field}><span>{t('ms.f.title')}</span><input ref={titleRef} type="text" autoComplete="off" maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-invalid={!!errs.title} />{errs.title && <span className={ui.err} role="alert">{t('ms.v.title')}</span>}</label>
                    <label className={ui.field}><span>{t('ms.f.description')}</span><input type="text" autoComplete="off" maxLength={320} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} aria-invalid={!!errs.description} />{errs.description && <span className={ui.err} role="alert">{t('ms.v.description')}</span>}</label>
                    <TechPicker techs={techs} error={techError} value={tech} onChange={setTech} label={t('ms.f.tech')} />
                    {errs.tech && <p className={ui.err} role="alert">{t('ms.v.tech')}</p>}
                    <label className={ui.field}><span>{t('ms.f.due')}</span><input type="date" value={form.due} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setForm({ ...form, due: e.target.value })} aria-invalid={!!errs.due} />{errs.due && <span className={ui.err} role="alert">{t('ms.v.due')}</span>}</label>
                    <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={!!busy}>{t('ms.f.create')}</button><button type="button" className={ui.btnGhost} onClick={() => setAdding(null)}>{t('ms.f.cancel')}</button></div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      ))}
    </section>
  );
}
