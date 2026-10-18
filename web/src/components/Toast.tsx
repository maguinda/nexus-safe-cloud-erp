import { useEffect } from 'react';
import s from './Toast.module.css';

/** Aviso corto y accesible (role=status): se lee en voz alta sin quitar el foco. */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { if (!message) return; const id = setTimeout(onDone, 3500); return () => clearTimeout(id); }, [message, onDone]);
  return <div role="status" aria-live="polite" className={message ? s.toast : s.hidden}>{message}</div>;
}
