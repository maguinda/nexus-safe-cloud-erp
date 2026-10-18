import { decodeClaims } from '../lib/jwt';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './JwtPanel.module.css';

/** Muestra lo que el navegador envía en cada petición. Es solo informativo: el servidor verifica la firma. */
export function JwtPanel() {
  const { token, expireNow } = useSession();
  const claims = token ? decodeClaims(token) : null;
  return (
    <details className={s.box}>
      <summary>JWT sample (what the browser sends on every request)</summary>
      <pre className={s.pre}>{claims ? JSON.stringify(claims, null, 2) : 'No readable token'}</pre>
      <p className={ui.muted}>The signature is added by the Identity service and checked again by every service.</p>
      <button type="button" className={ui.btnGhost} onClick={expireNow}>Simulate expired token</button>
    </details>
  );
}
