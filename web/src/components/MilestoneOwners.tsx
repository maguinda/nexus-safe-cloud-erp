import { useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import type { Milestone, MilestoneOwnerInfo } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { ProgressBar } from './shared/ProgressBar';
import { StatusChip } from './shared/StatusChip';
import { StaffPicker, type StaffChoice } from './StaffPicker';
import s from './MilestoneOwners.module.css';

/** Responsables de los hitos (líder de proyecto): quién es el ingeniero de cada hito y cómo van sus actividades. Solo se cambia mientras el hito está pendiente. */
export function MilestoneOwners({ projectId, milestones, toast }: { projectId: string; milestones: Milestone[]; toast: (m: string) => void }) {
  const { api, t } = useSession();
  const alive = useAlive();
  const [info, setInfo] = useState<MilestoneOwnerInfo[] | null>(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [choice, setChoice] = useState<StaffChoice | null>(null);
  const [pickError, setPickError] = useState(false);
  const [busy, setBusy] = useState('');
  const inflight = useRef(false);
  const req = useRef(0);

  const load = useCallback(async () => {
    const my = ++req.current;
    try { const r = await api.milestoneProgress(projectId); if (alive.current && my === req.current) { setInfo(r); setError(''); } } catch (e) { if (alive.current && my === req.current) setError(t('own.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t, projectId]);
  // Se vuelve a pedir al cambiar de proyecto y cuando cambian los hitos (por ejemplo, tras aprobar uno).
  useEffect(() => { setInfo(null); setPicking(null); void load(); }, [load, milestones]);

  async function act(key: string, work: () => Promise<string>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(key);
    try { toast(await work()); await load(); } catch (e) { toast(t('own.failed', { reason: errorText(e, t, 'server.unexpected') })); } finally { inflight.current = false; if (alive.current) setBusy(''); }
  }
  const by = (id: string) => info?.find((x) => x.milestoneId === id);

  return (
    <section aria-labelledby="own-h" className={s.stack}>
      <h2 id="own-h" className={ui.h2}>{t('own.title')}</h2>
      <p className={ui.muted}>{t('own.intro')}</p>
      {error && <div className={ui.panelError} role="alert"><strong>{error}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>}
      {info === null && !error ? <p role="status" className={ui.muted}>{t('own.loading')}</p> : info && milestones.length > 0 && (
        <div className={ui.scroll}>
          <table className={`${ui.tableDense} ${ui.cardsOnPhone}`}>
            <caption className={s.sr}>{t('own.caption')}</caption>
            <thead><tr><th>{t('own.col.milestone')}</th><th>{t('own.col.owner')}</th><th>{t('own.col.progress')}</th><th>{t('own.col.action')}</th></tr></thead>
            <tbody>
              {milestones.flatMap((m) => {
                const o = by(m.id);
                const pending = m.status === 'pending';
                const row = (
                  <tr key={m.id} data-owner-of={m.id}>
                    <th scope="row" className={s.rowHead}><span className={s.headCell}><span>{m.name}</span><StatusChip tone={pending ? 'warn' : 'ok'} icon={pending ? 'clock' : 'check'}>{t(pending ? 'projects.status.pending' : 'projects.status.approved')}</StatusChip></span></th>
                    <td data-label={t('own.col.owner')} data-col="owner">{o?.ownerName ? <span className={s.what}>{o.ownerName}</span> : <StatusChip tone="neutral" icon="users">{t('own.none')}</StatusChip>}</td>
                    <td data-label={t('own.col.progress')} data-col="progress">
                      {o && o.progress.total > 0
                        ? <ProgressBar value={o.progress.done} max={o.progress.total} tone={o.progress.done === o.progress.total ? 'ok' : undefined} label={t('own.col.progress')} caption={t('own.progress', { done: o.progress.done, total: o.progress.total })} />
                        : <span className={ui.muted}>{t('own.noActivities')}</span>}
                    </td>
                    <td data-label={t('own.col.action')}>
                      {!pending ? <span className={ui.muted}>{t('own.approved')}</span> : (
                        <span className={s.rowActions}>
                          {picking !== m.id && <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('own.assignFor', { milestone: m.name })} onClick={() => { setPicking(m.id); setChoice(null); setPickError(false); }}>{t(o?.ownerId ? 'own.change' : 'own.assign')}</button>}
                          {o?.ownerId && <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('own.clearFor', { milestone: m.name })} onClick={() => void act(`c:${m.id}`, async () => { await api.setMilestoneOwner(m.id, null); return t('own.cleared', { milestone: m.name }); })}>{t('own.clear')}</button>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
                if (picking !== m.id) return [row];
                return [row, (
                  <tr key={`${m.id}-p`} className={s.subRow}>
                    <td colSpan={4}>
                      <div className={s.form} role="group" aria-label={t('own.assignFor', { milestone: m.name })}>
                        <StaffPicker label={t('own.pick')} value={choice} onChange={(v) => { setChoice(v); setPickError(false); }} kind="engineer" />
                        {pickError && <p className={ui.err} role="alert">{t('own.pickFirst')}</p>}
                        <div className={ui.formActions}>
                          <button type="button" className={ui.btn} disabled={!!busy} onClick={() => { if (!choice) { setPickError(true); return; } void act(`a:${m.id}`, async () => { await api.setMilestoneOwner(m.id, choice); setPicking(null); return t('own.assigned', { milestone: m.name, name: choice.name }); }); }}>{t('own.confirm')}</button>
                          <button type="button" className={ui.btnGhost} onClick={() => setPicking(null)}>{t('own.cancel')}</button>
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
    </section>
  );
}
