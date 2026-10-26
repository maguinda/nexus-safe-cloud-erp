import { useCallback, useEffect, useRef } from 'react';

/** Pide llevar el foco a un título cuando ya hay resultados (así se lee el contador nuevo). `request()` lo arma; el efecto lo cumple una vez. */
export function useFocusWhenReady(ready: boolean): { ref: React.RefObject<HTMLHeadingElement | null>; request: () => void } {
  const ref = useRef<HTMLHeadingElement>(null);
  const pending = useRef(false);
  useEffect(() => {
    if (pending.current && ready) { pending.current = false; ref.current?.focus(); ref.current?.scrollIntoView({ block: 'start' }); }
  }, [ready]);
  return { ref, request: useCallback(() => { pending.current = true; }, []) };
}
