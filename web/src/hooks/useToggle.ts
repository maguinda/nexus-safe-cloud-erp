import { useCallback, useState } from 'react';

/** Un interruptor de sí/no (por ejemplo, ver u ocultar la contraseña). */
export function useToggle(initial = false): [boolean, () => void] {
  const [on, setOn] = useState(initial);
  return [on, useCallback(() => setOn((v) => !v), [])];
}
