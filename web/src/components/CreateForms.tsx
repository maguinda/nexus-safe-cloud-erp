import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/api';
import type { TFn } from '../i18n';
import { errorText } from '../i18n/server';
import type { Milestone, Project } from '../lib/types';
import { checkText, parseAmount } from '../lib/validate';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

const failMessage = (e: unknown, t: TFn) => (e instanceof ApiError && e.status === 403 ? t('projects.form.forbidden') : errorText(e, t, 'projects.form.saveFailed'));

/** Alta de un proyecto. Se valida aquí con los mismos criterios del servidor (que vuelve a validar): se avisa, no se recorta. */
export function NewProjectForm({ api, onCreated }: { api: Api; onCreated: (p: Project) => void }) {
  const { t } = useSession();
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [errors, setErrors] = useState<{ name?: string; client?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { name: checkText(t, name, 'project name'), client: checkText(t, client, 'client name') };
    setErrors({ name: next.name || undefined, client: next.client || undefined });
    if (next.name || next.client) return;
    setBusy(true);
    try {
      const p = await api.createProject(name, client);
      setName(''); setClient('');
      onCreated(p);
    } catch (err) {
      setErrors({ form: failMessage(err, t) });
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-project-h" className={ui.formCard}>
      <h2 id="new-project-h" className={ui.h2}>{t('projects.form.newProject')}</h2>
      <div className={ui.formGrid}>
        <label className={ui.field}>
          <span>{t('projects.form.projectName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'np-name-err' : undefined} />
          {errors.name && <span id="np-name-err" className={ui.err}>{errors.name}</span>}
        </label>
        <label className={ui.field}>
          <span>{t('projects.form.client')}</span>
          <input value={client} onChange={(e) => setClient(e.target.value)} aria-invalid={!!errors.client} aria-describedby={errors.client ? 'np-client-err' : undefined} />
          {errors.client && <span id="np-client-err" className={ui.err}>{errors.client}</span>}
        </label>
      </div>
      {errors.form && <p role="alert" className={ui.err}>{errors.form}</p>}
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{busy ? t('projects.form.creating') : t('projects.form.create')}</button></div>
    </form>
  );
}

/** Alta de un hito pendiente dentro del proyecto elegido. */
export function AddMilestoneForm({ api, project, onCreated }: { api: Api; project: Project; onCreated: (m: Milestone) => void }) {
  const { t } = useSession();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<{ name?: string; amount?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const nameError = checkText(t, name, 'milestone name');
    const parsed = parseAmount(t, amount);
    setErrors({ name: nameError || undefined, amount: parsed.error || undefined });
    if (nameError || parsed.error) return;
    setBusy(true);
    try {
      const m = await api.createMilestone(project.id, name, parsed.value);
      setName(''); setAmount('');
      onCreated(m);
    } catch (err) {
      setErrors({ form: failMessage(err, t) });
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="add-ms-h" className={ui.formCard}>
      <h3 id="add-ms-h" className={ui.h2}>{t('projects.form.addTitle', { name: project.name })}</h3>
      <div className={ui.formGrid}>
        <label className={ui.field}>
          <span>{t('projects.form.milestoneName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'am-name-err' : undefined} />
          {errors.name && <span id="am-name-err" className={ui.err}>{errors.name}</span>}
        </label>
        <label className={ui.field}>
          <span>{t('projects.form.amount')}</span>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount} aria-describedby={errors.amount ? 'am-amount-err' : undefined} />
          {errors.amount && <span id="am-amount-err" className={ui.err}>{errors.amount}</span>}
        </label>
      </div>
      {errors.form && <p role="alert" className={ui.err}>{errors.form}</p>}
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{busy ? t('projects.form.adding') : t('projects.form.add')}</button></div>
    </form>
  );
}
