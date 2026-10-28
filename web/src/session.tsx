import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LANG, isLang, Lang, makeT, MsgKey, TFn } from './i18n';
import { ApiError, createApi, Api } from './lib/api';
import { applyTheme, DEFAULT_THEME, isTheme } from './lib/theme';
import { secondsLeft } from './lib/jwt';
import { classifyRenewal, CONFLICT_RETRIES, CONFLICT_RETRY_MS, isSamePerson, shouldRenew, TRANSIENT_RETRY_MS } from './lib/session-renewal';
import type { LoginResponse, Theme, User } from './lib/types';

interface Session {
  user: User | null;
  secondsLeft: number;
  /** Clave del aviso que se muestra en el login (p. ej. «tu sesión venció»); vacío si no hay. */
  notice: MsgKey | '';
  /** Idioma de la interfaz: el de la persona que inició sesión; antes de entrar, el último usado en este navegador (o español). */
  lang: Lang;
  t: TFn;
  /** Tema de la interfaz: el de la persona que inició sesión; antes de entrar, el último usado en este navegador (o «system»). */
  theme: Theme;
  /** Guarda el tema en el servidor (es de la persona, la sigue a cualquier equipo) y cambia la pantalla. Lanza si el servidor lo rechaza. */
  setTheme: (theme: Theme) => Promise<void>;
  /** Guarda el idioma en el servidor (es de la persona, la sigue a cualquier equipo) y cambia la pantalla. Lanza si el servidor lo rechaza. */
  setLanguage: (lang: Lang) => Promise<void>;
  api: Api;
  signIn: (email: string, password: string) => Promise<void>;
  /** Cierra la sesión: aquí y en el servidor (revoca la renovación y borra la cookie). */
  signOut: () => void;
  /** Había una sesión guardada con el token vencido y se está intentando renovarla: todavía no se sabe si hay que mostrar el inicio de sesión. */
  booting: boolean;
  /** Para la demo: hace que el token venza y la siguiente petición reciba 401. */
  expireNow: () => void;
  token: string | null;
}

const Ctx = createContext<Session | null>(null);
const KEY = 'erp.session';
const LANG_KEY = 'erp.lang';
const THEME_KEY = 'erp.theme';

// El último idioma usado en ESTE navegador: solo sirve para la pantalla de login, antes de saber quién entra.
const storedLang = (): Lang | null => { try { const v = localStorage.getItem(LANG_KEY); return isLang(v) ? v : null; } catch { return null; } };
const rememberLang = (l: Lang) => { try { localStorage.setItem(LANG_KEY, l); } catch { /* sin almacenamiento */ } };
const storedTheme = (): Theme | null => { try { const v = localStorage.getItem(THEME_KEY); return isTheme(v) ? v : null; } catch { return null; } };
const rememberTheme = (th: Theme) => { try { localStorage.setItem(THEME_KEY, th); } catch { /* sin almacenamiento */ } };

// sessionStorage solo para no perder la sesión al recargar la pestaña; si no está disponible, la app funciona igual.
const load = (): { token: string; user: User } | null => { try { const s = sessionStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const save = (v: { token: string; user: User } | null) => { try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } };

export function SessionProvider({ children }: { children: ReactNode }) {
  // Una sesión guardada con el token ya vencido (la pestaña estuvo dormida) todavía puede renovarse con la cookie: antes de mostrar el inicio de sesión se intenta.
  const stored = useRef(load());
  const [state, setState] = useState<{ token: string; user: User } | null>(() => { const s = stored.current; return s && secondsLeft(s.token) > 0 ? s : null; });
  const [booting, setBooting] = useState(() => stored.current !== null && secondsLeft(stored.current.token) <= 0);
  const [notice, setNotice] = useState<MsgKey | ''>('');
  const [left, setLeft] = useState(0);
  const tokenRef = useRef<string | null>(state?.token ?? null);
  tokenRef.current = state?.token ?? null;
  const stateRef = useRef(state);
  stateRef.current = state;
  const renewingRef = useRef(false);
  const nextTryRef = useRef(0);
  const unauthorizedRef = useRef<() => void>(() => undefined);

  const signOut = useCallback((message: MsgKey | '' = '') => { save(null); setState(null); setNotice(message); }, []);
  const api = useMemo(() => createApi({ getToken: () => tokenRef.current, onUnauthorized: () => unauthorizedRef.current() }), []);

  /** Aplica una renovación SOLO si es de la persona que ya está en pantalla (la cookie es del navegador, no de la pestaña: otra persona pudo entrar en otra). */
  const applyRenewal = useCallback((r: LoginResponse): boolean => {
    const current = stateRef.current?.user ?? stored.current?.user;
    if (current && !isSamePerson(current, r.user)) return false;
    const next = { token: r.accessToken, user: r.user };
    tokenRef.current = r.accessToken;
    nextTryRef.current = 0; // token nuevo: la próxima renovación vuelve a intentarse a tiempo
    save(next); setNotice(''); setState(next);
    return true;
  }, []);

  /** Renueva la sesión con la cookie. 'busy' si ya hay una renovación en curso. Una a la vez por pestaña y, con Web Locks, una a la vez entre las pestañas del navegador. */
  const renew = useCallback(async (): Promise<'renewed' | 'expired' | 'transient' | 'busy'> => {
    if (renewingRef.current) return 'busy';
    renewingRef.current = true;
    const run = async (): Promise<'renewed' | 'expired' | 'transient'> => {
      for (let attempt = 0; ; attempt++) {
        try { return applyRenewal(await api.refresh()) ? 'renewed' : 'expired'; }
        catch (e) {
          const kind = classifyRenewal(e instanceof ApiError ? e.status : 'network');
          // 409: otra pestaña renovó con la misma cookie un instante antes; la cookie del navegador ya es la nueva, se reintenta.
          if (kind === 'conflict') { if (attempt < CONFLICT_RETRIES) { await new Promise((r) => setTimeout(r, CONFLICT_RETRY_MS)); continue; } return 'transient'; }
          return kind === 'expired' ? 'expired' : 'transient';
        }
      }
    };
    try { return await (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('erp-renew', run) : run()); }
    finally { renewingRef.current = false; }
  }, [api, applyRenewal]);

  // Un 401 de la API en una petición con token: el token ya no sirve. Antes de sacar a la persona se intenta renovar; si no hay sesión que renovar, sale.
  unauthorizedRef.current = () => { void renew().then((kind) => { if (kind === 'expired') signOut('notice.sessionExpired'); }); };

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    const next = { token: r.accessToken, user: r.user };
    stored.current = next;
    nextTryRef.current = 0;
    save(next); setNotice(''); setState(next);
    if (isLang(r.user.language)) rememberLang(r.user.language);
    if (isTheme(r.user.theme)) rememberTheme(r.user.theme);
  }, [api]);

  const setTheme = useCallback(async (theme: Theme) => {
    await api.setTheme(theme);
    rememberTheme(theme);
    setState((s) => { if (!s) return s; const next = { ...s, user: { ...s.user, theme } }; save(next); return next; });
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
    const tick = () => {
      const s = secondsLeft(state.token);
      setLeft(s);
      // Cuando faltan 2 minutos o menos (o ya venció) se renueva en silencio; si no hay sesión que renovar, sale con el aviso.
      if (shouldRenew(s) && !renewingRef.current && Date.now() >= nextTryRef.current) {
        void renew().then((kind) => {
          if (kind === 'expired') {
            // No hay sesión que renovar. Si el token todavía vale se deja trabajar hasta que venza (como antes de existir la renovación: no se saca a nadie
            // ANTES de tiempo); si ya venció, sale ahora.
            if (secondsLeft(tokenRef.current ?? '') <= 0) signOut('notice.sessionExpired');
            else nextTryRef.current = Number.POSITIVE_INFINITY;
          } else if (kind === 'transient') nextTryRef.current = Date.now() + TRANSIENT_RETRY_MS;
        });
      }
      // Venció y no hay una renovación en curso: no hay nada más que intentar.
      if (s <= 0 && !renewingRef.current) signOut('notice.sessionExpired');
    };
    tick();
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick); // una pestaña dormida despierta y renueva de inmediato
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [state, renew, signOut]);

  const bootRan = useRef(false);
  useEffect(() => {
    if (!booting || bootRan.current) return;
    bootRan.current = true;
    void renew().then((kind) => {
      setBooting(false);
      if (kind !== 'renewed') { save(null); setNotice('notice.sessionExpired'); }
    });
  }, [booting, renew]);

  const signOutHere = useCallback(() => { void api.logout(); stored.current = null; signOut(''); }, [api, signOut]);

  const lang: Lang = isLang(state?.user.language) ? state.user.language : (storedLang() ?? DEFAULT_LANG);
  const t = useMemo(() => makeT(lang), [lang]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const theme: Theme = isTheme(state?.user.theme) ? state.user.theme : (storedTheme() ?? DEFAULT_THEME);
  // useLayoutEffect: se aplica antes de pintar, para que no haya un destello del tema equivocado al recargar.
  useLayoutEffect(() => { applyTheme(theme, document.documentElement as unknown as Parameters<typeof applyTheme>[1]); }, [theme]);

  const value: Session = { user: state?.user ?? null, token: state?.token ?? null, secondsLeft: left, notice, lang, t, theme, setTheme, setLanguage, api, signIn, signOut: signOutHere, booting, expireNow };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Atajo para las pantallas: `const t = useT()` y luego `t('clave', { valor })`. */
export const useT = (): TFn => useSession().t;

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
