import { useEffect, useId, useRef, useState } from 'react';
import { errorText } from '../i18n/server';
import { THEMES } from '../lib/theme';
import type { Theme } from '../lib/types';
import { Lang, LANGS, translate } from '../i18n';
import { roleKey } from '../lib/types';
import { useSession } from '../session';
import s from './ProfileMenu.module.css';

/** Cada idioma se muestra SIEMPRE con su propio nombre, para poder encontrarlo aunque la pantalla esté en el otro. */
const NAME: Record<Lang, string> = { es: 'Español', en: 'English' };
const THEME_KEY = { system: 'theme.system', light: 'theme.light', dark: 'theme.dark' } as const;

/** Perfil de la persona: sus datos y el idioma de la interfaz. El idioma se guarda en el servidor, así la sigue a cualquier equipo. */
export function ProfileMenu({ onChanged }: { onChanged: (message: string) => void }) {
  const { user, lang, t, theme, setLanguage, setTheme, api, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = (back: boolean) => { setOpen(false); setError(''); if (back) trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    const outside = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) close(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', outside); };
  }, [open]);

  if (!user) return null;

  const choose = async (next: Lang) => {
    if (next === lang || saving) return;
    setSaving(true); setError('');
    try {
      await setLanguage(next);
      onChanged(translate(next, 'profile.saved', { language: NAME[next] })); // el aviso ya sale en el idioma nuevo
    } catch (e) {
      // El idioma NO cambió: la pantalla sigue como estaba y se dice por qué.
      setError(t('profile.error', { reason: errorText(e, t, 'server.unexpected') }));
    } finally { setSaving(false); }
  };

  const chooseTheme = async (next: Theme) => {
    if (next === theme || saving) return;
    setSaving(true); setError('');
    try {
      await setTheme(next);
      onChanged(t('theme.saved', { theme: t(THEME_KEY[next]) }));
    } catch (e) {
      // El tema NO cambió: la pantalla sigue como estaba y se dice por qué.
      setError(t('theme.error', { reason: errorText(e, t, 'server.unexpected') }));
    } finally { setSaving(false); }
  };

  const logoutAll = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await api.logoutAll();
      signOut(); // las sesiones ya están cerradas en el servidor: esta pantalla también sale
    } catch (e) {
      // Las sesiones NO se cerraron: la persona sigue dentro y se le dice por qué.
      setError(t('profile.logoutAllError', { reason: errorText(e, t, 'server.unexpected') }));
      setSaving(false);
    }
  };

  return (
    <div className={s.wrap} ref={root}>
      <button
        ref={trigger} type="button" className={s.trigger} aria-haspopup="dialog" aria-expanded={open}
        aria-label={t('profile.open', { name: user.name, role: t(roleKey(user.role)) })} onClick={() => (open ? close(false) : setOpen(true))}
      >
        {t(roleKey(user.role))}
      </button>
      {open && (
        <div className={s.panel} role="dialog" aria-labelledby={titleId}>
          <h2 id={titleId} className={s.title}>{t('profile.title')}</h2>
          <dl className={s.facts}>
            <dt>{t('profile.name')}</dt><dd>{user.name}</dd>
            <dt>{t('profile.email')}</dt><dd>{user.email}</dd>
            <dt>{t('profile.role')}</dt><dd>{t(roleKey(user.role))}</dd>
          </dl>
          <fieldset className={s.group}>
            <legend>{t('profile.language')}</legend>
            <div className={s.options}>
              {LANGS.map((l, i) => (
                <button key={l} ref={i === 0 ? first : undefined} type="button" className={s.option} lang={l} aria-pressed={lang === l} disabled={saving} onClick={() => void choose(l)}>{NAME[l]}</button>
              ))}
            </div>
            <p className={s.help}>{t('profile.languageHelp')}</p>
          </fieldset>
          <fieldset className={s.group}>
            <legend>{t('theme.title')}</legend>
            <div className={`${s.options} ${s.optionsThree}`}>
              {THEMES.map((th) => (
                <button key={th} type="button" className={s.option} aria-pressed={theme === th} disabled={saving} onClick={() => void chooseTheme(th)}>{t(THEME_KEY[th])}</button>
              ))}
            </div>
            <p className={s.help}>{t('theme.help')}</p>
          </fieldset>
          <fieldset className={s.group}>
            <legend>{t('profile.sessions')}</legend>
            <button type="button" className={s.option} disabled={saving} onClick={() => void logoutAll()}>{t('profile.logoutAll')}</button>
            <p className={s.help}>{t('profile.logoutAllHelp')}</p>
          </fieldset>
          {saving && <p className={s.status} role="status">{t('profile.saving')}</p>}
          {error && <p className={s.error} role="alert">{error}</p>}
          <button type="button" className={s.close} onClick={() => close(true)}>{t('profile.close')}</button>
        </div>
      )}
    </div>
  );
}
