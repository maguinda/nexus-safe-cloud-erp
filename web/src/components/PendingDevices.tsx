import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { checkConfiguration, CRITICALITIES, PENDING_ROLE, warrantyState } from '../lib/configure';
import type { ConfigureErrors, ConfigureForm } from '../lib/configure';
import type { PurchasedDevice } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './PendingDevices.module.css';

const EMPTY: ConfigureForm = { role: '', criticality: '', ips: '', serial: '', warrantyUntil: '', assignedTo: '' };

/**
 * Equipos que vinieron de una compra: los «pendientes de configurar» (sin rol real) y los ya completos, con su serie, garantía y a quién se asignaron.
 * Solo gerencia. Sin equipos comprados no se muestra nada.
 */
export function PendingDevices({ onChanged }: { onChanged?: () => void }) {
  const { api, t } = useSession();
  const alive = useAlive();
  const [rows, setRows] = useState<PurchasedDevice[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [f, setF] = useState<ConfigureForm>(EMPTY);
  const [errors, setErrors] = useState<ConfigureErrors & { form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const inflight = useRef(false);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    try { const p = await api.purchasedDevices(); if (alive.current) setRows(p); } catch { /* sin panel si no se pudo leer */ }
  }, [api, alive]);
  useEffect(() => { void load(); }, [load]);

  const open = (d: PurchasedDevice) => {
    setOpenId(d.id); setErrors({}); setDone('');
    const pending = d.role === PENDING_ROLE;
    setF({ role: pending ? '' : d.role, criticality: pending ? '' : d.criticality, ips: d.ips ?? '', serial: d.serial.startsWith(`${d.order}-`) ? '' : d.serial, warrantyUntil: d.warrantyUntil ?? '', assignedTo: d.assignedTo ?? '' });
  };
  async function save(e: FormEvent, d: PurchasedDevice) {
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
  const pendingCount = rows.filter((d) => d.role === PENDING_ROLE).length;
  return (
    <section aria-labelledby="cfg-h">
      <h3 id="cfg-h" className={ui.h2}>{pendingCount > 0 ? t('cfg.title') : t('cfg.title2')}</h3>
      <p className={ui.muted}>{t('cfg.intro')} {t('cfg.note')}</p>
      {done && <p role="status">{done}</p>}
      <ul className={s.list}>
        {rows.map((d) => {
          const pending = d.role === PENDING_ROLE;
          const w = warrantyState(d.warrantyUntil, today);
          return (
            <li key={d.id} data-unit={d.name} {...(pending ? { 'data-pending': d.name } : {})} className={`${ui.formCard} ${s.unit}`}>
              <strong>{d.name}</strong> <span className={ui.muted}>{d.model}</span>{' '}
              {pending ? <span className={ui.err}>{t('cfg.pending')}</span> : <span>{d.role} · {d.criticality}</span>}
              <p className={ui.muted}>
                {t('cfg.col.serial')}: {d.serial} · {t('cfg.col.warranty')}: {d.warrantyUntil ? `${t('cfg.warrantyUntil', { date: d.warrantyUntil })}${w === 'expired' ? ` (${t('cfg.warranty.expired')})` : w === 'soon' ? ` (${t('cfg.warranty.soon')})` : ''}` : t('cfg.none')} · {t('cfg.col.assigned')}: {d.assignedTo ?? t('cfg.none')}
              </p>
              {openId !== d.id && <button type="button" className={ui.btnGhost} aria-label={t(pending ? 'cfg.openFor' : 'cfg.editFor', { name: d.name })} onClick={() => open(d)}>{pending ? t('cfg.open') : t('cfg.edit')}</button>}
              {openId === d.id && (
                <form onSubmit={(e) => void save(e, d)} noValidate aria-label={t(pending ? 'cfg.openFor' : 'cfg.editFor', { name: d.name })}>
                  <div className={ui.formGrid}>
                    <label className={ui.field}><span>{t('cfg.field.role')}</span><input type="text" autoComplete="off" maxLength={80} value={f.role} onChange={(x) => setF({ ...f, role: x.target.value })} aria-invalid={!!errors.role} />{errors.role && <span className={ui.err}>{errors.role}</span>}</label>
                    <fieldset className={ui.field}><legend>{t('cfg.field.criticality')}</legend>
                      <div className={ui.seg}>{CRITICALITIES.map((c) => <button key={c} type="button" className={f.criticality === c ? ui.segBtnOn : ui.segBtn} aria-pressed={f.criticality === c} onClick={() => setF({ ...f, criticality: c })}>{c}</button>)}</div>
                      {errors.criticality && <span className={ui.err}>{errors.criticality}</span>}</fieldset>
                    <label className={ui.field}><span>{t('cfg.field.ips')}</span><input type="text" autoComplete="off" maxLength={120} value={f.ips} onChange={(x) => setF({ ...f, ips: x.target.value })} aria-invalid={!!errors.ips} />{errors.ips && <span className={ui.err}>{errors.ips}</span>}</label>
                    <label className={ui.field}><span>{t('cfg.field.serial')}</span><input type="text" autoComplete="off" maxLength={60} value={f.serial} onChange={(x) => setF({ ...f, serial: x.target.value })} aria-invalid={!!errors.serial} />{errors.serial && <span className={ui.err}>{errors.serial}</span>}</label>
                    <label className={ui.field}><span>{t('cfg.field.warranty')}</span><input type="date" value={f.warrantyUntil} onChange={(x) => setF({ ...f, warrantyUntil: x.target.value })} aria-invalid={!!errors.warrantyUntil} />{errors.warrantyUntil && <span className={ui.err}>{errors.warrantyUntil}</span>}</label>
                    <label className={ui.field}><span>{t('cfg.field.assigned')}</span><input type="text" autoComplete="off" maxLength={100} value={f.assignedTo} onChange={(x) => setF({ ...f, assignedTo: x.target.value })} aria-invalid={!!errors.assignedTo} />{errors.assignedTo && <span className={ui.err}>{errors.assignedTo}</span>}</label>
                  </div>
                  {errors.form && <p className={ui.err} role="alert">{errors.form}</p>}
                  <div className={ui.formActions}>
                    <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('cfg.saving') : t('cfg.save')}</button>
                    <button type="button" className={ui.btnGhost} onClick={() => setOpenId(null)}>{t('cfg.cancel')}</button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
