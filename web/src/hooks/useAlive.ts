import { useEffect, useRef } from 'react';

/** Dice si el componente sigue montado, para no escribir estado después de salir de la pantalla. */
export function useAlive(): { current: boolean } {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}
