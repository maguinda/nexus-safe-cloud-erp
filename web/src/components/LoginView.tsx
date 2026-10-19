import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './LoginView.module.css';

const DEMO = [
  { email: 'laura.rios@nexus.example', label: 'Project lead' },
  { email: 'andres.mora@nexus.example', label: 'Billing analyst' },
  { email: 'camila.soto@nexus.example', label: 'Sales' },
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginView() {
  const { signIn, notice } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Mismos criterios que el servidor (email válido hasta 254, contraseña de 1 a 128): se avisa aquí, nunca se recorta en silencio.
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Enter your email.';
    else if (email.length > 254) next.email = 'The email is too long (254 characters at most).';
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email, like name@company.com.';
    if (!password) next.password = 'Enter your password.';
    else if (password.length > 128) next.password = 'The password is too long (128 characters at most).';
    setErrors(next);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setErrors({ form: status === 401 ? 'The email or password is not correct.' : status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'We could not sign you in. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={s.wrap}>
      <form className={s.form} onSubmit={submit} noValidate aria-labelledby="signin-title">
        <h1 id="signin-title" className={s.title}>Sign in</h1>
        <p className={ui.muted}>Use one of the demo accounts. The Identity service checks the password and signs the token.</p>
        {notice && <p role="status" className={s.notice}>{notice}</p>}

        <div className={s.demo} role="group" aria-label="Demo accounts">
          {DEMO.map((d) => (
            <button key={d.email} type="button" className={ui.btnGhost} onClick={() => { setEmail(d.email); setErrors({}); }}>{d.label}</button>
          ))}
        </div>

        <label className={ui.field}>
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined} />
          {errors.email && <span id="email-err" className={ui.err}>{errors.email}</span>}
        </label>
        <label className={ui.field}>
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'pw-err' : undefined} />
          {errors.password && <span id="pw-err" className={ui.err}>{errors.password}</span>}
        </label>
        {errors.form && <p role="alert" className={ui.err}>{errors.form}</p>}
        <button type="submit" className={ui.btn} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
