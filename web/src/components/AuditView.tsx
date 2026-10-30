import { useCallback, useEffect, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import type { AuditResponse } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

/** Auditoría (solo gerencia): cuándo, quién (si el evento lo dice) y qué, de cada evento que pasó por el bus. Solo se agrega: nadie puede editarla. */
export function AuditView() {
  const { api, t, lang } = useSession();
  const alive = useAlive();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [type, setType] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const r = await api.audit(type || undefined); if (alive.current) { setData(r); setError(''); } } catch (e) { if (alive.current) setError(t('audit.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, type, t]);
  useEffect(() => { void load(); }, [load]);

  const when = (iso: string) => new Date(iso).toLocaleString(lang === 'es' ? 'es-CO' : 'en-US', { dateStyle: 'short', timeStyle: 'medium' });
  return (
    <section aria-labelledby="audit-h">
      <h2 id="audit-h" className={ui.h2}>{t('audit.title')}</h2>
      <p className={ui.muted}>{t('audit.intro')}</p>
      {error && <p className={ui.panelError} role="alert">{error}</p>}
      <div className={ui.toolbar}>
        {/* Botones y no un <select> nativo: en WebKit mide menos de 32 px y la auditoría de diseño lo rechaza. */}
        <div className={ui.seg} role="group" aria-label={t('audit.filter')}>
          {['', ...(data?.types ?? (type ? [type] : []))].map((x) => <button key={x || 'all'} type="button" className={type === x ? ui.segBtnOn : ui.segBtn} aria-pressed={type === x} onClick={() => setType(x)}>{x || t('audit.all')}</button>)}
        </div>
        <button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('audit.refresh')}</button>
      </div>
      {data === null ? <p className={ui.muted} role="status">…</p> : data.entries.length === 0 ? <p className={ui.muted}>{t('audit.empty')}</p> : (
        <div className={ui.scroll}>
          <table className={`${ui.table} ${ui.cardsOnPhone}`}>
            <caption className="sr-only">{t('audit.title')}</caption>
            <thead><tr><th>{t('audit.col.when')}</th><th>{t('audit.col.who')}</th><th>{t('audit.col.what')}</th><th>{t('audit.col.type')}</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.eventId} data-type={e.type}>
                  <td data-label={t('audit.col.when')}>{when(e.occurredAt)}</td>
                  <td data-label={t('audit.col.who')}>{e.actor ?? t('audit.noActor')}</td>
                  <td data-label={t('audit.col.what')}>{e.summary}</td>
                  <td data-label={t('audit.col.type')} className={ui.mono}>{e.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
