import { FormEvent, useState } from 'react';
import type { Api } from '../lib/api';
import { ApiError } from '../lib/api';
import { errorText } from '../i18n/server';
import { CERT_MAX, checkAllocation, checkLabel, checkTags, NAME_MAX, parseTags, ROLE_MAX, TAG_MAX } from '../lib/capacity';
import type { CapacityEngineer } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './CapacityView.module.css';

/** Alta de un ingeniero (solo gerencia). Se valida aquí con los mismos criterios del servidor: se avisa, no se recorta. */
export function NewEngineerForm({ api, onCreated }: { api: Api; onCreated: (name: string) => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ name: '', role: '', skills: '', certs: '' });
  const [errors, setErrors] = useState<{ name?: string; role?: string; skills?: string; certs?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      name: checkLabel(t, f.name, 'capacity.field.name', 2, NAME_MAX), role: checkLabel(t, f.role, 'capacity.field.role', 2, ROLE_MAX),
      skills: checkTags(t, f.skills, 'capacity.field.skills', TAG_MAX), certs: checkTags(t, f.certs, 'capacity.field.certs', CERT_MAX),
    };
    setErrors({ name: next.name || undefined, role: next.role || undefined, skills: next.skills || undefined, certs: next.certs || undefined });
    if (next.name || next.role || next.skills || next.certs) return;
    setBusy(true);
    try {
      const created = await api.createEngineer({ name: f.name.replace(/\s+/g, ' ').trim(), role: f.role.replace(/\s+/g, ' ').trim(), skills: parseTags(f.skills), certifications: parseTags(f.certs) });
      setF({ name: '', role: '', skills: '', certs: '' });
      onCreated(created.name);
    } catch (err) { setErrors({ form: t('capacity.saveFailed', { reason: errorText(err, t, 'server.unexpected') }) }); } finally { setBusy(false); }
  }

  const field = (k: 'name' | 'role' | 'skills' | 'certs', label: Parameters<typeof t>[0], max: number, hint?: boolean) => (
    <label className={ui.field}>
      <span>{t(label)}</span>
      <input type="text" autoComplete="off" value={f[k]} maxLength={k === 'skills' || k === 'certs' ? 1000 : max + 20} onChange={set(k)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `ne-${k}-err` : undefined} />
      {hint && <span className={ui.muted}>{t('capacity.hint.tags')}</span>}
      {errors[k] && <span id={`ne-${k}-err`} className={ui.err}>{errors[k]}</span>}
    </label>
  );
  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-eng-h" className={ui.formCard}>
      <h3 id="new-eng-h" className={ui.h2}>{t('capacity.newEngineer')}</h3>
      <div className={ui.formGrid}>
        {field('name', 'capacity.field.name', NAME_MAX)}
        {field('role', 'capacity.field.role', ROLE_MAX)}
        {field('skills', 'capacity.field.skills', TAG_MAX, true)}
        {field('certs', 'capacity.field.certs', CERT_MAX, true)}
      </div>
      {errors.form && <p className={ui.err} role="alert">{errors.form}</p>}
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{busy ? t('capacity.saving') : t('capacity.createEngineer')}</button></div>
    </form>
  );
}

/** Asignar a un ingeniero. Pasar de 100 % responde 409 con el máximo; solo gerencia ve la casilla para permitirlo a propósito. */
export function AllocateForm({ api, engineer, isManager, onDone, onCancel }: { api: Api; engineer: CapacityEngineer; isManager: boolean; onDone: (message: string) => void; onCancel: () => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ project: '', percent: '', start: '', end: '' });
  const [allowOver, setAllowOver] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof checkAllocation>['errors'] & { form?: string }>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const id = `al-${engineer.id}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { errors: errs, value } = checkAllocation(t, f);
    setErrors(errs);
    if (!value) return;
    setBusy(true);
    try {
      const r = await api.allocate(engineer.id, { ...value, ...(isManager && allowOver ? { allowOverallocation: true } : {}) });
      onDone(r.overAllocated ? t('capacity.allocatedOver', { name: engineer.name, peak: r.peak }) : t('capacity.allocated', { name: engineer.name, project: value.projectName, percent: value.percent }));
    } catch (err) {
      // 409: se muestra el máximo que resultaría; la asignación NO se guardó.
      setErrors({ form: err instanceof ApiError ? errorText(err, t, 'server.unexpected') : t('capacity.saveFailed', { reason: errorText(err, t, 'server.unexpected') }) });
    } finally { setBusy(false); }
  }

  const input = (k: 'project' | 'percent' | 'start' | 'end', label: Parameters<typeof t>[0], extra: object = {}) => (
    <label className={ui.field}>
      <span>{t(label)}</span>
      <input type="text" autoComplete="off" value={f[k]} onChange={set(k)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${id}-${k}-err` : undefined} {...extra} />
      {errors[k] && <span id={`${id}-${k}-err`} className={ui.err}>{errors[k]}</span>}
    </label>
  );
  return (
    <form onSubmit={submit} noValidate aria-label={t('capacity.allocateFor', { name: engineer.name })} className={ui.formCard}>
      <div className={ui.formGrid}>
        {input('project', 'capacity.field.project', { maxLength: 100 })}
        {input('percent', 'capacity.field.percent', { inputMode: 'numeric', maxLength: 4 })}
        {input('start', 'capacity.field.start', { maxLength: 12, placeholder: '2026-11-02' })}
        {input('end', 'capacity.field.end', { maxLength: 12, placeholder: '2026-11-30' })}
      </div>
      {isManager && (
        <label className={s.check}><input type="checkbox" checked={allowOver} onChange={(e) => setAllowOver(e.target.checked)} /><span>{t('capacity.field.allowOver')}</span></label>
      )}
      {errors.form && <p className={ui.err} role="alert">{errors.form}</p>}
      <div className={ui.formActions}>
        <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('capacity.saving') : t('capacity.save')}</button>
        <button type="button" className={ui.btnGhost} onClick={onCancel}>{t('capacity.cancel')}</button>
      </div>
    </form>
  );
}
