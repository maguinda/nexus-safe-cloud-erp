import { useEffect, useRef, useState } from 'react';
import type { Page } from '../lib/types';

export type Result<T> = { state: 'loading' } | { state: 'error'; cause: unknown } | { state: 'ready'; data: Page<T> };

/** Pide una página cuando cambia `key` (con espera opcional) y descarta respuestas viejas que lleguen después de una nueva. */
export function useQueryResult<T>(load: () => Promise<Page<T>>, key: string, debounceMs: number): { result: Result<T>; reload: () => void } {
  const [result, setResult] = useState<Result<T>>({ state: 'loading' });
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const loader = useRef(load); loader.current = load;
  useEffect(() => {
    const mine = ++seq.current;
    setResult((r) => (r.state === 'ready' ? r : { state: 'loading' }));
    const id = setTimeout(() => {
      loader.current().then((data) => { if (mine === seq.current) setResult({ state: 'ready', data }); }, (cause) => { if (mine === seq.current) setResult({ state: 'error', cause }); });
    }, debounceMs);
    return () => clearTimeout(id);
  }, [key, nonce, debounceMs]);
  return { result, reload: () => setNonce((n) => n + 1) };
}
