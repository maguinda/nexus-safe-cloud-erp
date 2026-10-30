import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { checkConfiguration, CRITICALITIES, PENDING_ROLE } from '../lib/configure';
import type { ConfigureErrors } from '../lib/configure';
import type { NetworkDeviceItem } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

/** Equipos comprados que aún dicen «Pendiente de configurar»: gerencia completa rol, criticidad e IP. Sin equipos pendientes no se muestra nada. */
export function PendingDevices({ onChanged }: { onChanged?: () => void }) {
  const { api, t } = useSession();
  const alive = useAlive();
  const [rows, setRows] = useState<NetworkDeviceItem[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [f, setF] = useState({ role: '', criticality: '', ips: '' });
  const [errors, setErrors] = useState<ConfigureErrors & { form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const inflight = useRef(false);

  const load = useCallback(async () => {
    try { const p = await api.networkDevices({ category: 'Equipo comprado', limit: 100, sort: 'name' }); if (alive.current) setRows(p.items.filter((d) => d.role === PENDING_ROLE)); } catch { /* sin panel si no se pudo leer */ }
  }, [api, alive]);
  useEffect(() => { void load(); }, [load]);

  async function save(e: FormEvent, d: NetworkDeviceItem) {
    e.preventDefault();
    if (inflight.current) return;
    const { errors: errs, value } = checkConfiguration(t, f);
    setErrors(errs);
    if (!value) return;
    inflight.current = true; setBusy(true);
    try { await api.configureDevice(d.id, value); setDone(t('cfg.done', { name: d.name })); setOpenId(null); onChanged?.(); }
    catch (x) { setErrors({ form: t('cfg.failed', { reason: errorText(x, t, 'server.unexpected') }) }); }
    finally { inflight.current = false; setBusy(false); await load(); }
  }

  if (rows.length === 0 && !done) return null;
  return (
    <section aria-labelledby="cfg-h">
      <h3 id="cfg-h" className={ui.h2}>{t('cfg.title')}</h3>
      <p className={ui.muted}>{t('cfg.intro')} {t('cfg.note')}</p>
      {done && <p role="status">{done}</p>}
      <ul>
        {rows.map((d) => (
          <li key={d.id} data-pending={d.name} className={ui.formCard}>
            <strong>{d.name}</strong> <span className={ui.muted}>{d.model}</span>{' '}
            {openId !== d.id && <button type="button" className={ui.btnGhost} aria-label={t('cfg.openFor', { name: d.name })} onClick={() => { setOpenId(d.id); setF({ role: '', criticality: '', ips: '' }); setErrors({}); setDone(''); }}>{t('cfg.open')}</button>}
            {openId === d.id && (
              <form onSubmit={(e) => void save(e, d)} noValidate aria-label={t('cfg.openFor', { name: d.name })}>
                <div className={ui.formGrid}>
                  <label className={ui.field}><span>{t('cfg.field.role')}</span><input type="text" autoComplete="off" maxLength={80} value={f.role} onChange={(x) => setF({ ...f, role: x.target.value })} aria-invalid={!!errors.role} />{errors.role && <span className={ui.err}>{errors.role}</span>}</label>
                  <fieldset className={ui.field}><legend>{t('cfg.field.criticality')}</legend>
                    <div className={ui.seg}>{CRITICALITIES.map((c) => <button key={c} type="button" className={f.criticality === c ? ui.segBtnOn : ui.segBtn} aria-pressed={f.criticality === c} onClick={() => setF({ ...f, criticality: c })}>{c}</button>)}</div>
                    {errors.criticality && <span className={ui.err}>{errors.criticality}</span>}</fieldset>
                  <label className={ui.field}><span>{t('cfg.field.ips')}</span><input type="text" autoComplete="off" maxLength={120} value={f.ips} onChange={(x) => setF({ ...f, ips: x.target.value })} aria-invalid={!!errors.ips} />{errors.ips && <span className={ui.err}>{errors.ips}</span>}</label>
                </div>
                {errors.form && <p className={ui.err} role="alert">{errors.form}</p>}
                <div className={ui.formActions}>
                  <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('cfg.saving') : t('cfg.save')}</button>
                  <button type="button" className={ui.btnGhost} onClick={() => setOpenId(null)}>{t('cfg.cancel')}</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
