import { useCallback, useEffect, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatDay } from '../lib/format';
import type { CapacityEngineer, CapacityResponse } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { AllocateForm, NewEngineerForm } from './CapacityForms';
import s from './CapacityView.module.css';

/** Capacidad técnica (US-07): ventas, líderes de proyecto y gerencia ven quién está libre; líder y gerente asignan; gerencia agrega ingenieros. */
export function CapacityView({ toast }: { toast: (m: string) => void }) {
  const { api, user, t, lang } = useSession();
  const alive = useAlive();
  const [data, setData] = useState<CapacityResponse | null>(null);
  const [error, setError] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [busyRemove, setBusyRemove] = useState('');
  const canAllocate = user?.role === 'project_lead' || user?.role === 'manager';
  const isManager = user?.role === 'manager';

  const load = useCallback(async () => {
    try { const r = await api.capacity(); if (alive.current) { setData(r); setError(''); } } catch (e) { if (alive.current) setError(errorText(e, t, 'server.unexpected')); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  const remove = async (engineer: CapacityEngineer, id: string, project: string) => {
    if (busyRemove) return;
    setBusyRemove(id);
    try { await api.deleteAllocation(id); toast(t('capacity.removed')); await load(); } catch (e) { toast(t('capacity.saveFailed', { reason: errorText(e, t, 'server.unexpected') })); } finally { if (alive.current) setBusyRemove(''); }
    void engineer; void project;
  };

  if (error) return <div className={ui.panelError} role="alert"><strong>{t('capacity.loadError', { reason: error })}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('capacity.retry')}</button></div>;
  return (
    <section aria-labelledby="cap-h" className={s.stack}>
      <h2 id="cap-h" className={ui.h2}>{t('capacity.title')}</h2>
      <p className={ui.muted}>{t('capacity.intro')}</p>
      {isManager && <NewEngineerForm api={api} onCreated={(name) => { toast(t('capacity.engineerCreated', { name })); void load(); }} />}
      {data === null ? <p role="status" className={ui.muted}>{t('capacity.loading')}</p> : data.engineers.length === 0 ? <p className={ui.muted}>{t('capacity.empty')}</p> : (
        <ul className={s.list}>
          {data.engineers.map((e) => (
            <li key={e.id} className={s.card} data-engineer={e.name}>
              <div className={s.head}>
                <div><h3 className={s.name}>{e.name}</h3><span className={ui.muted}>{e.role}</span></div>
                {canAllocate && openFor !== e.id && <button type="button" className={ui.btnGhost} aria-label={t('capacity.allocateFor', { name: e.name })} onClick={() => setOpenFor(e.id)}>{t('capacity.allocate')}</button>}
              </div>
              <div className={s.bar} role="img" aria-label={t('capacity.bar', { load: e.loadToday })}>
                <div className={e.loadToday > 100 ? s.fillOver : e.loadToday >= 90 ? s.fillFull : s.fill} style={{ ['--w' as string]: `${Math.min(100, e.loadToday)}%` }} />
              </div>
              <p className={s.nums}>{t('capacity.summary', { load: e.loadToday, free: e.freeToday, peak: e.peakNext30 })}</p>
              <p className={s.tags}><strong>{t('capacity.skills')}:</strong> {e.skills.length ? e.skills.join(', ') : t('capacity.none')}</p>
              <p className={s.tags}><strong>{t('capacity.certs')}:</strong> {e.certifications.length ? e.certifications.join(', ') : t('capacity.none')}</p>
              <h4 className={s.sub}>{t('capacity.allocations')}</h4>
              {e.allocations.length === 0 ? <p className={ui.muted}>{t('capacity.noAllocations')}</p> : (
                <ul className={s.allocs}>
                  {e.allocations.map((a) => (
                    <li key={a.id} className={s.alloc}>
                      <span>{t('capacity.allocLine', { project: a.projectName, percent: a.percent, from: formatDay(`${a.startDate}T00:00:00Z`, lang), to: formatDay(`${a.endDate}T00:00:00Z`, lang) })}</span>
                      {a.overAllocated && <strong className={s.overTag}>{t('capacity.over')}</strong>}
                      {canAllocate && <button type="button" className={ui.btnGhost} disabled={busyRemove === a.id} aria-label={t('capacity.removeLabel', { project: a.projectName, name: e.name })} onClick={() => void remove(e, a.id, a.projectName)}>{t('capacity.remove')}</button>}
                    </li>
                  ))}
                </ul>
              )}
              {openFor === e.id && <AllocateForm api={api} engineer={e} isManager={!!isManager} onCancel={() => setOpenFor(null)} onDone={(m) => { setOpenFor(null); toast(m); void load(); }} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
