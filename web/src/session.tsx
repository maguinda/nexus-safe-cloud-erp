import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LANG, isLang, Lang, makeT, MsgKey, TFn } from './i18n';
import { createApi, Api } from './lib/api';
import { secondsLeft } from './lib/jwt';
import type { User } from './lib/types';

interface Session {
  user: User | null;
  secondsLeft: number;
  /** Clave del aviso que se muestra en el login (p. ej. «tu sesión venció»); vacío si no hay. */
  notice: MsgKey | '';
  /** Idioma de la interfaz: el de la persona que inició sesión; antes de entrar, el último usado en este navegador (o español). */
  lang: Lang;
  t: TFn;
  /** Guarda el idioma en el servidor (es de la persona, la sigue a cualquier equipo) y cambia la pantalla. Lanza si el servidor lo rechaza. */
  setLanguage: (lang: Lang) => Promise<void>;
  api: Api;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Para la demo: hace que el token venza y la siguiente petición reciba 401. */
  expireNow: () => void;
  token: string | null;
}

const Ctx = createContext<Session | null>(null);
const KEY = 'erp.session';
const LANG_KEY = 'erp.lang';

// El último idioma usado en ESTE navegador: solo sirve para la pantalla de login, antes de saber quién entra.
const storedLang = (): Lang | null => { try { const v = localStorage.getItem(LANG_KEY); return isLang(v) ? v : null; } catch { return null; } };
const rememberLang = (l: Lang) => { try { localStorage.setItem(LANG_KEY, l); } catch { /* sin almacenamiento */ } };

// sessionStorage solo para no perder la sesión al recargar la pestaña; si no está disponible, la app funciona igual.
const load = (): { token: string; user: User } | null => { try { const s = sessionStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const save = (v: { token: string; user: User } | null) => { try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ token: string; user: User } | null>(() => { const s = load(); return s && secondsLeft(s.token) > 0 ? s : null; });
  const [notice, setNotice] = useState<MsgKey | ''>('');
  const [left, setLeft] = useState(0);
  const tokenRef = useRef<string | null>(state?.token ?? null);
  tokenRef.current = state?.token ?? null;

  const signOut = useCallback((message: MsgKey | '' = '') => { save(null); setState(null); setNotice(message); }, []);
  const api = useMemo(() => createApi({ getToken: () => tokenRef.current, onUnauthorized: () => signOut('notice.sessionExpired') }), [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    const next = { token: r.accessToken, user: r.user };
    save(next); setNotice(''); setState(next);
    if (isLang(r.user.language)) rememberLang(r.user.language);
  }, [api]);

  const setLanguage = useCallback(async (lang: Lang) => {
    await api.setLanguage(lang);
    rememberLang(lang);
    setState((s) => { if (!s) return s; const next = { ...s, user: { ...s.user, language: lang } }; save(next); return next; });
  }, [api]);

  const expireNow = useCallback(() => {
    // Reemplaza el token por uno ya vencido (el payload lleva exp en el pasado): la API responderá 401.
    setState((s) => {
      if (!s) return s;
      const [h, , sig] = s.token.split('.');
      const p = btoa(JSON.stringify({ exp: 1 })).replace(/=+$/, '');
      const t = `${h}.${p}.${sig}`;
      tokenRef.current = t;
      return { ...s, token: t };
    });
  }, []);

  useEffect(() => {
    if (!state) { setLeft(0); return; }
    const tick = () => { const s = secondsLeft(state.token); setLeft(s); if (s <= 0) signOut('notice.sessionExpired'); };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state, signOut]);

  const lang: Lang = isLang(state?.user.language) ? state.user.language : (storedLang() ?? DEFAULT_LANG);
  const t = useMemo(() => makeT(lang), [lang]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const value: Session = { user: state?.user ?? null, token: state?.token ?? null, secondsLeft: left, notice, lang, t, setLanguage, api, signIn, signOut: () => signOut(''), expireNow };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Atajo para las pantallas: `const t = useT()` y luego `t('clave', { valor })`. */
export const useT = (): TFn => useSession().t;

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
