import { decodeClaims } from '../lib/jwt';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './JwtPanel.module.css';

/** Muestra lo que el navegador envía en cada petición. Es solo informativo: el servidor verifica la firma. */
export function JwtPanel() {
  const { token, expireNow, t } = useSession();
  const claims = token ? decodeClaims(token) : null;
  return (
    <details className={s.box}>
      <summary>{t('jwt.summary')}</summary>
      <pre className={s.pre}>{claims ? JSON.stringify(claims, null, 2) : t('jwt.none')}</pre>
      <p className={ui.muted}>{t('jwt.note')}</p>
      <button type="button" className={ui.btnGhost} onClick={expireNow}>{t('jwt.expire')}</button>
    </details>
  );
}
