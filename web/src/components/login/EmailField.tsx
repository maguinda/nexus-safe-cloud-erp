import type { TFn } from '../../i18n';
import { MailIcon } from './icons';
import s from './login.module.css';

interface Props { value: string; onChange: (v: string) => void; error?: string; t: TFn }

export function EmailField({ value, onChange, error, t }: Props) {
  return (
    <div className={s.field}>
      <label htmlFor="login-email">{t('login.email')}</label>
      <div className={s.inputWrap}>
        <span className={s.lead}><MailIcon /></span>
        <input id="login-email" className={s.input} type="email" autoComplete="username" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'email-err' : undefined} />
      </div>
      {error && <span id="email-err" className={s.err}>{error}</span>}
    </div>
  );
}
