import { useCallback, useRef } from 'react';

/** Aplica un cambio al explorador y lleva allí la vista y el foco (sin animar si la persona pidió menos movimiento). */
export function useGoExplorer<S>(apply: (f: (s: S) => S) => void): { ref: React.RefObject<HTMLElement | null>; go: (f: (s: S) => S) => void } {
  const ref = useRef<HTMLElement>(null);
  const go = useCallback((f: (s: S) => S) => {
    apply(f);
    requestAnimationFrame(() => {
      const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      ref.current?.focus({ preventScroll: true });
    });
  }, [apply]);
  return { ref, go };
}
