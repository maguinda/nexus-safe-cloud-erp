import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { errorText } from '../i18n/server';
import type { TeamMember } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

/** Equipo del proyecto (viene del evento EngineerAllocated de Technical Capacity). Ventas no lo ve: la API le responde 403 y aquí no se muestra nada. */
export function ProjectTeam({ projectId }: { projectId: string }) {
  const { api, t } = useSession();
  const [rows, setRows] = useState<{ id: string; list: TeamMember[] } | null>(null);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    setError(''); setHidden(false);
    const load = () => api.projectTeam(projectId).then((list) => { if (live) { setRows({ id: projectId, list }); setError(''); } }).catch((e) => {
      if (!live) return;
      if (e instanceof ApiError && e.status === 403) setHidden(true); else setError(errorText(e, t, 'server.unexpected'));
    });
    void load();
    // El equipo llega por eventos: se vuelve a pedir al volver a la pestaña (y cada vez que se abre la pantalla), sin un temporizador que pida en segundo plano.
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [api, projectId, t]);

  if (hidden) return null;
  return (
    <section aria-labelledby="team-h">
      <h2 id="team-h" className={ui.h2}>{t('team.title')}</h2>
      {error && <p className={ui.panelError} role="alert">{error}</p>}
      {rows?.id !== projectId ? <p className={ui.muted} role="status">…</p> : rows.list.length === 0 ? <p className={ui.muted}>{t('team.empty')}</p> : (
        <div className={ui.scroll}>
          <table className={`${ui.table} ${ui.cardsOnPhone}`}>
            <caption className="sr-only">{t('team.title')}</caption>
            <thead><tr><th>{t('team.col.engineer')}</th><th className={ui.num}>{t('team.col.percent')}</th><th>{t('team.col.period')}</th></tr></thead>
            <tbody>{rows.list.map((m, i) => (
              <tr key={`${m.engineerName}-${m.periodStart}-${i}`}>
                <td>{m.engineerName}</td>
                <td className={ui.num} data-label={t('team.col.percent')}>{m.percent} %</td>
                <td data-label={t('team.col.period')}>{m.periodStart} → {m.periodEnd}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
