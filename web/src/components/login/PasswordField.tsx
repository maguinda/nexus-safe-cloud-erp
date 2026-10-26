import { useToggle } from '../../hooks/useToggle';
import type { TFn } from '../../i18n';
import { EyeIcon, EyeOffIcon, LockIcon } from './icons';
import s from './login.module.css';

interface Props { value: string; onChange: (v: string) => void; error?: string; t: TFn }

/** Campo de contraseña con ícono y botón para ver los caracteres. El nombre del botón no repite la palabra «contraseña» para no confundirse con el campo. */
export function PasswordField({ value, onChange, error, t }: Props) {
  const [shown, toggle] = useToggle();
  return (
    <div className={s.field}>
      <label htmlFor="login-password">{t('login.password')}</label>
      <div className={s.inputWrap}>
        <span className={s.lead}><LockIcon /></span>
        <input id="login-password" className={s.input} type={shown ? 'text' : 'password'} autoComplete="current-password" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'pw-err' : undefined} />
        <button type="button" data-in-field className={s.eye} onClick={toggle} aria-pressed={shown} aria-label={t(shown ? 'login.hideChars' : 'login.showChars')}>{shown ? <EyeOffIcon /> : <EyeIcon />}</button>
      </div>
      {error && <span id="pw-err" className={s.err}>{error}</span>}
    </div>
  );
}
