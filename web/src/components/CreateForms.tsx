import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/api';
import type { Milestone, Project } from '../lib/types';
import { checkText, parseAmount } from '../lib/validate';
import ui from '../styles/ui.module.css';

const failMessage = (e: unknown) => (e instanceof ApiError ? (e.status === 403 ? 'Your role cannot create this.' : e.message) : 'We could not save it. Check your connection and try again.');

/** Alta de un proyecto. Se valida aquí con los mismos criterios del servidor (que vuelve a validar): se avisa, no se recorta. */
export function NewProjectForm({ api, onCreated }: { api: Api; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [errors, setErrors] = useState<{ name?: string; client?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { name: checkText(name, 'project name'), client: checkText(client, 'client name') };
    setErrors({ name: next.name || undefined, client: next.client || undefined });
    if (next.name || next.client) return;
    setBusy(true);
    try {
      const p = await api.createProject(name, client);
      setName(''); setClient('');
      onCreated(p);
    } catch (err) {
      setErrors({ form: failMessage(err) });
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-project-h" className={ui.card}>
      <h2 id="new-project-h" className={ui.h2}>New project</h2>
      <div className={ui.formGrid}>
        <label className={ui.field}>
          <span>Project name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'np-name-err' : undefined} />
          {errors.name && <span id="np-name-err" className={ui.err}>{errors.name}</span>}
        </label>
        <label className={ui.field}>
          <span>Client</span>
          <input value={client} onChange={(e) => setClient(e.target.value)} aria-invalid={!!errors.client} aria-describedby={errors.client ? 'np-client-err' : undefined} />
          {errors.client && <span id="np-client-err" className={ui.err}>{errors.client}</span>}
        </label>
      </div>
      {errors.form && <p role="alert" className={ui.err}>{errors.form}</p>}
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button></div>
    </form>
  );
}

/** Alta de un hito pendiente dentro del proyecto elegido. */
export function AddMilestoneForm({ api, project, onCreated }: { api: Api; project: Project; onCreated: (m: Milestone) => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<{ name?: string; amount?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const nameError = checkText(name, 'milestone name');
    const parsed = parseAmount(amount);
    setErrors({ name: nameError || undefined, amount: parsed.error || undefined });
    if (nameError || parsed.error) return;
    setBusy(true);
    try {
      const m = await api.createMilestone(project.id, name, parsed.value);
      setName(''); setAmount('');
      onCreated(m);
    } catch (err) {
      setErrors({ form: failMessage(err) });
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="add-ms-h" className={ui.card}>
      <h3 id="add-ms-h" className={ui.h2}>Add a milestone to {project.name}</h3>
      <div className={ui.formGrid}>
        <label className={ui.field}>
          <span>Milestone name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'am-name-err' : undefined} />
          {errors.name && <span id="am-name-err" className={ui.err}>{errors.name}</span>}
        </label>
        <label className={ui.field}>
          <span>Amount (COP, before VAT)</span>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount} aria-describedby={errors.amount ? 'am-amount-err' : undefined} />
          {errors.amount && <span id="am-amount-err" className={ui.err}>{errors.amount}</span>}
        </label>
      </div>
      {errors.form && <p role="alert" className={ui.err}>{errors.form}</p>}
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{busy ? 'Adding…' : 'Add milestone'}</button></div>
    </form>
  );
}
