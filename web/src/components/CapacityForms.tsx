import { FormEvent, useEffect, useState } from 'react';
import type { Api } from '../lib/api';
import { ApiError } from '../lib/api';
import { errorText } from '../i18n/server';
import { CERT_MAX, checkAllocation, checkLabel, checkTags, NAME_MAX, parseTags, ROLE_MAX, TAG_MAX } from '../lib/capacity';
import { checkSalary } from '../lib/profitability';
import { STAFF_POSITIONS, type CapacityEngineer, type StaffPosition } from '../lib/types';
import { Pick } from './ProcurementForms';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './CapacityView.module.css';

/** Alta de un ingeniero (solo gerencia). Se valida aquí con los mismos criterios del servidor: se avisa, no se recorta. */
export function NewEngineerForm({ api, onCreated }: { api: Api; onCreated: (name: string) => void }) {
  const { t } = useSession();
  const [f, setF] = useState({ name: '', role: '', skills: '', certs: '', salary: '' });
  const [position, setPosition] = useState<StaffPosition | ''>('');
  const [errors, setErrors] = useState<{ name?: string; role?: string; skills?: string; certs?: string; position?: string; salary?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      name: checkLabel(t, f.name, 'capacity.field.name', 2, NAME_MAX), role: f.role.trim() === '' ? '' : checkLabel(t, f.role, 'capacity.field.role', 2, ROLE_MAX),
      position: position === '' ? t('capacity.v.position') : '', salary: checkSalary(t, f.salary).error ?? '',
      skills: checkTags(t, f.skills, 'capacity.field.skills', TAG_MAX), certs: checkTags(t, f.certs, 'capacity.field.certs', CERT_MAX),
    };
    setErrors({ name: next.name || undefined, role: next.role || undefined, skills: next.skills || undefined, certs: next.certs || undefined, position: next.position || undefined, salary: next.salary || undefined });
    if (next.name || next.role || next.skills || next.certs || next.position || next.salary || position === '') return;
    setBusy(true);
    try {
      const created = await api.createEngineer({ name: f.name.replace(/\s+/g, ' ').trim(), position, ...(f.role.trim() ? { role: f.role.replace(/\s+/g, ' ').trim() } : {}), skills: parseTags(f.skills), certifications: parseTags(f.certs), ...(checkSalary(t, f.salary).value ? { monthlySalaryCop: checkSalary(t, f.salary).value as number } : {}) });
      setF({ name: '', role: '', skills: '', certs: '', salary: '' }); setPosition('');
      onCreated(created.name);
    } catch (err) { setErrors({ form: t('capacity.saveFailed', { reason: errorText(err, t, 'server.unexpected') }) }); } finally { setBusy(false); }
  }

  const field = (k: 'name' | 'role' | 'skills' | 'certs' | 'salary', label: Parameters<typeof t>[0], max: number, hint?: boolean) => (
    <label className={ui.field}>
      <span>{t(label)}</span>
      <input type="text" autoComplete="off" value={f[k]} maxLength={k === 'skills' || k === 'certs' ? 1000 : k === 'salary' ? 9 : max + 20} onChange={set(k)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `ne-${k}-err` : undefined} />
      {hint && <span className={ui.muted}>{t('capacity.hint.tags')}</span>}
      {errors[k] && <span id={`ne-${k}-err`} className={ui.err}>{errors[k]}</span>}
    </label>
  );
  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-eng-h" className={ui.formCard}>
      <h3 id="new-eng-h" className={ui.h2}>{t('capacity.newEngineer')}</h3>
      <div className={ui.formGrid}>
        {field('name', 'capacity.field.name', NAME_MAX)}
        <Pick wrap id="ne-position" label={t('capacity.field.position')} value={position} onChange={(v) => setPosition(v as StaffPosition)} options={STAFF_POSITIONS.map((p) => ({ value: p, label: t(`position.${p}` as 'position.tech_lead') }))} error={errors.position} />
        {field('role', 'capacity.field.roleTitle', ROLE_MAX)}
        {field('salary', 'capacity.field.salary', 9)}
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
  // Los proyectos salen de Projects (nada de teclear el nombre): si la lista no se pudo traer, se deja escribir.
  const [projects, setProjects] = useState<string[] | null>(null);
  useEffect(() => { let live = true; api.projects().then((p) => { if (live) setProjects(p.map((x) => x.name)); }).catch(() => { if (live) setProjects(null); }); return () => { live = false; }; }, [api]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { errors: errs, value } = checkAllocation(t, f);
    if (!errs.project && projects && !projects.includes(f.project.replace(/\s+/g, ' ').trim())) errs.project = t('capacity.v.projectUnknown');
    setErrors(errs);
    if (!value || errs.project) return;
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
      <input type="text" autoComplete="off" list={k === 'project' && projects ? `${id}-projects` : undefined} value={f[k]} onChange={set(k)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${id}-${k}-err` : undefined} {...extra} />
      {errors[k] && <span id={`${id}-${k}-err`} className={ui.err}>{errors[k]}</span>}
    </label>
  );
  return (
    <form onSubmit={submit} noValidate aria-label={t('capacity.allocateFor', { name: engineer.name })} className={ui.formCard}>
      <div className={ui.formGrid}>
        {input('project', 'capacity.field.project', { maxLength: 100 })}
        {projects && <datalist id={`${id}-projects`}>{projects.map((p) => <option key={p} value={p} />)}</datalist>}
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
