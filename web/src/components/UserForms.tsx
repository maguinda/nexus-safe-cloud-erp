import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/api';
import { ROLE_LABEL } from '../lib/types';
import type { ManagedUser, Role } from '../lib/types';
import { MAX_EMAIL, checkEmail, checkPassword } from '../lib/user-validate';
import { MAX_TEXT, checkText } from '../lib/validate';
import ui from '../styles/ui.module.css';
import s from './UsersView.module.css';

const ROLES: Role[] = ['project_lead', 'billing_analyst', 'sales', 'manager'];
const failMessage = (e: unknown) => (e instanceof ApiError ? (e.status === 403 ? 'Your role cannot do this. Sign in again.' : e.message) : 'We could not save it. Check your connection and try again.');

/** Grupo de botones para elegir un rol (no es un <select> nativo: en WebKit mide menos de 32 px y la auditoría lo rechaza). */
function RoleChoice({ value, onChange, label }: { value: Role; onChange: (r: Role) => void; label: string }) {
  return (
    <fieldset className={s.group}>
      <legend>{label}</legend>
      <div className={s.roles}>
        {ROLES.map((r) => (
          <button key={r} type="button" className={value === r ? ui.segBtnOn : ui.segBtn} aria-pressed={value === r} onClick={() => onChange(r)}>{ROLE_LABEL[r]}</button>
        ))}
      </div>
    </fieldset>
  );
}

/** Alta de un usuario. Se valida aquí con los mismos criterios del servidor (que vuelve a validar): se avisa, no se recorta. */
export function NewUserForm({ api, onCreated }: { api: Api; onCreated: (u: ManagedUser) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('sales');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; name?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { email: checkEmail(email), name: checkText(name, 'name'), password: '' };
    next.password = checkPassword(password, email);
    setErrors({ email: next.email || undefined, name: next.name || undefined, password: next.password || undefined });
    if (next.email || next.name || next.password) return;
    setBusy(true);
    try {
      const u = await api.createUser({ email: email.trim().toLowerCase(), name, role, password });
      setEmail(''); setName(''); setPassword(''); setShow(false); setRole('sales');
      onCreated(u);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setErrors({ email: 'That email is already registered.' });
      else setErrors({ form: failMessage(err) });
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-user-h" className={ui.formCard}>
      <h2 id="new-user-h" className={ui.h2}>New user</h2>
      <div className={ui.formGrid}>
        <label className={ui.field}>
          <span>Email</span>
          <input type="email" autoComplete="off" value={email} maxLength={MAX_EMAIL + 20} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'nu-email-err' : undefined} />
          {errors.email && <span id="nu-email-err" className={ui.err}>{errors.email}</span>}
        </label>
        <label className={ui.field}>
          <span>Full name</span>
          <input autoComplete="off" value={name} maxLength={MAX_TEXT + 20} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'nu-name-err' : undefined} />
          {errors.name && <span id="nu-name-err" className={ui.err}>{errors.name}</span>}
        </label>
      </div>
      <RoleChoice value={role} onChange={setRole} label="Role" />
      <div className={ui.field}>
        <label htmlFor="nu-password">Initial password</label>
        <div className={s.pwRow}>
          <input id="nu-password" type={show ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'nu-pw-err' : 'nu-pw-hint'} />
          <button type="button" className={ui.btnGhost} aria-pressed={show} onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>
        </div>
        {errors.password ? <span id="nu-pw-err" className={ui.err}>{errors.password}</span> : <span id="nu-pw-hint" className={s.hint}>At least 12 characters (72 bytes at most), not containing the email, with 4 or more different characters. The person can sign in with it right away.</span>}
      </div>
      {errors.form && <p role="alert" className={ui.err}>{errors.form}</p>}
      <div className={ui.formActions}><button type="submit" className={ui.btn} disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button></div>
    </form>
  );
}

/** Cambio de rol de otra persona. El servidor lo aplica desde su siguiente inicio de sesión (el token dura 15 minutos). */
export function ChangeRoleForm({ api, user, onSaved, onCancel }: { api: Api; user: ManagedUser; onSaved: (u: ManagedUser) => void; onCancel: () => void }) {
  const [role, setRole] = useState<Role>(user.role);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (role === user.role) { setError(`${user.name} already has that role.`); return; }
    setBusy(true); setError('');
    try { onSaved(await api.changeRole(user.id, role)); }
    catch (err) { setError(failMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="change-role-h" className={ui.formCard}>
      <h3 id="change-role-h" className={ui.h2}>Change role for {user.name} <span className={s.who}>({user.email})</span></h3>
      <RoleChoice value={role} onChange={(r) => { setRole(r); setError(''); }} label="New role" />
      <p className={s.note}>The new role applies from their next sign-in. You cannot change your own role, and the last manager cannot lose the role.</p>
      {error && <p role="alert" className={ui.err}>{error}</p>}
      <div className={s.actions}>
        <button type="submit" className={ui.btn} disabled={busy}>{busy ? 'Saving…' : 'Save role'}</button>
        <button type="button" className={ui.btnGhost} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
