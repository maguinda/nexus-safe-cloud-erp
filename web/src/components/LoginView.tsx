import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import { useSession } from '../session';
import { BrandPanel } from './login/BrandPanel';
import { DemoAccounts } from './login/DemoAccounts';
import { EmailField } from './login/EmailField';
import { PasswordField } from './login/PasswordField';
import s from './login/login.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Errors = { email?: string; password?: string; form?: string };

export function LoginView() {
  const { signIn, notice, t } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Mismos criterios que el servidor (email válido hasta 254, contraseña de 1 a 128): se avisa aquí, nunca se recorta en silencio.
    const next: Errors = {};
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
    <main className={s.page}>
      <BrandPanel t={t} />
      <section className={s.side}>
        <form className={s.form} onSubmit={submit} noValidate aria-labelledby="signin-title">
          <h1 id="signin-title" className={s.title}>{t('login.title')}</h1>
          <p className={s.intro}>{t('login.intro')}</p>
          {notice && <p role="status" className={s.notice}>{t(notice)}</p>}
          <DemoAccounts onPick={(v) => { setEmail(v); setErrors({}); }} t={t} />
          <EmailField value={email} onChange={setEmail} error={errors.email} t={t} />
          <PasswordField value={password} onChange={setPassword} error={errors.password} t={t} />
          {errors.form && <p role="alert" className={s.err}>{errors.form}</p>}
          <button type="submit" className={s.submit} disabled={busy}>{busy ? t('login.submitting') : t('login.submit')}</button>
        </form>
      </section>
    </main>
  );
}
