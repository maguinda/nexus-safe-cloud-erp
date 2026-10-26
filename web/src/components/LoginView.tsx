import { FormEvent, useState } from 'react';
import { MsgKey } from '../i18n';
import { ApiError } from '../lib/api';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './LoginView.module.css';

// El botón lleva el nombre del rol (se traduce); el correo es de la cuenta de demostración.
const DEMO: { email: string; label: MsgKey }[] = [
  { email: 'laura.rios@nexus.example', label: 'role.project_lead' },
  { email: 'andres.mora@nexus.example', label: 'role.billing_analyst' },
  { email: 'camila.soto@nexus.example', label: 'role.sales' },
  { email: 'diana.vega@nexus.example', label: 'role.manager' },
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginView() {
  const { signIn, notice, t } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Mismos criterios que el servidor (email válido hasta 254, contraseña de 1 a 128): se avisa aquí, nunca se recorta en silencio.
    const next: typeof errors = {};
    if (!email.trim()) next.email = t('login.err.emailRequired');
    else if (email.length > 254) next.email = t('login.err.emailLong', { max: 254 });
    else if (!EMAIL_RE.test(email.trim())) next.email = t('login.err.emailInvalid');
    if (!password) next.password = t('login.err.passwordRequired');
    else if (password.length > 128) next.password = t('login.err.passwordLong', { max: 128 });
    setErrors(next);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setErrors({ form: status === 401 ? t('login.err.badCredentials') : status === 429 ? t('login.err.tooMany') : t('login.err.generic') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={s.wrap}>
      <form className={s.form} onSubmit={submit} noValidate aria-labelledby="signin-title">
        <h1 id="signin-title" className={s.title}>{t('login.title')}</h1>
        <p className={ui.muted}>{t('login.intro')}</p>
        {notice && <p role="status" className={s.notice}>{t(notice)}</p>}

        <div className={s.demo} role="group" aria-label={t('login.demoAccounts')}>
          {DEMO.map((d) => (
            <button key={d.email} type="button" className={ui.btnGhost} onClick={() => { setEmail(d.email); setErrors({}); }}>{t(d.label)}</button>
          ))}
        </div>

        <label className={ui.field}>
          <span>{t('login.email')}</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined} />
          {errors.email && <span id="email-err" className={ui.err}>{errors.email}</span>}
        </label>
        <label className={ui.field}>
          <span>{t('login.password')}</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'pw-err' : undefined} />
          {errors.password && <span id="pw-err" className={ui.err}>{errors.password}</span>}
        </label>
        {errors.form && <p role="alert" className={ui.err}>{errors.form}</p>}
        <button type="submit" className={ui.btn} disabled={busy}>{busy ? t('login.submitting') : t('login.submit')}</button>
      </form>
    </main>
  );
}
