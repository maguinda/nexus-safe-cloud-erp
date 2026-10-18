import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createApi, Api } from './lib/api';
import { secondsLeft } from './lib/jwt';
import type { User } from './lib/types';

interface Session {
  user: User | null;
  secondsLeft: number;
  notice: string;
  api: Api;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Para la demo: hace que el token venza y la siguiente petición reciba 401. */
  expireNow: () => void;
  token: string | null;
}

const Ctx = createContext<Session | null>(null);
const KEY = 'erp.session';

// sessionStorage solo para no perder la sesión al recargar la pestaña; si no está disponible, la app funciona igual.
const load = (): { token: string; user: User } | null => { try { const s = sessionStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const save = (v: { token: string; user: User } | null) => { try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ token: string; user: User } | null>(() => { const s = load(); return s && secondsLeft(s.token) > 0 ? s : null; });
  const [notice, setNotice] = useState('');
  const [left, setLeft] = useState(0);
  const tokenRef = useRef<string | null>(state?.token ?? null);
  tokenRef.current = state?.token ?? null;

  const signOut = useCallback((message = '') => { save(null); setState(null); setNotice(message); }, []);
  const api = useMemo(() => createApi({ getToken: () => tokenRef.current, onUnauthorized: () => signOut('Your session expired. Sign in again.') }), [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    const next = { token: r.accessToken, user: r.user };
    save(next); setNotice(''); setState(next);
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
    const tick = () => { const s = secondsLeft(state.token); setLeft(s); if (s <= 0) signOut('Your session expired. Sign in again.'); };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state, signOut]);

  const value: Session = { user: state?.user ?? null, token: state?.token ?? null, secondsLeft: left, notice, api, signIn, signOut: () => signOut(''), expireNow };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
