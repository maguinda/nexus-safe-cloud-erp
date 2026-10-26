import { useEffect, useRef } from 'react';

/** Espera `ms` solo cuando cambió el texto de búsqueda (al escribir); al pulsar un filtro devuelve 0. */
export function useTypingDelay(q: string, ms: number): number {
  const last = useRef('');
  const delay = last.current !== q ? ms : 0;
  useEffect(() => { last.current = q; });
  return delay;
}
