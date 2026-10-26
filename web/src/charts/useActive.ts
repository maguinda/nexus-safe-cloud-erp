import { useState } from 'react';
import type { KeyboardEvent } from 'react';

/**
 * Qué posición (punto, barra, celda) está activa para el tooltip. La misma lectura sale con el cursor y con el teclado:
 * ← → ↑ ↓ mueven, Inicio y Fin saltan a los extremos, Escape suelta.
 */
export function useActive(count: number) {
  const [raw, setRaw] = useState<number | null>(null);
  const active = raw !== null && raw >= 0 && raw < count ? raw : null;
  const move = (d: number) => setRaw((a) => (count === 0 ? null : a === null ? (d > 0 ? 0 : count - 1) : Math.min(count - 1, Math.max(0, a + d))));
  const onKeyDown = (e: KeyboardEvent<Element>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(1), ArrowDown: () => move(1), ArrowLeft: () => move(-1), ArrowUp: () => move(-1),
      Home: () => setRaw(0), End: () => setRaw(Math.max(0, count - 1)), Escape: () => setRaw(null),
    };
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  };
  return { active, setActive: setRaw, onKeyDown, clear: () => setRaw(null) };
}
