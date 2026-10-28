import { useEffect, useState, type FC } from 'react';
import { formatNumber } from '../../charts/format';
import type { TFn } from '../../i18n';
import type { Lang } from '../../i18n/core';
import { ageParts } from '../../lib/sensors-live';
import s from './Sensors.module.css';

/**
 * «En vivo · actualizado hace 4 s», con cuántas lecturas llegaron desde que se abrió la pantalla; si el último refresco falló, avisa que los datos
 * son de antes. El reloj de «hace X s» es de este componente (no vuelve a pintar la pantalla cada segundo) y el lector de pantalla solo oye los
 * CAMBIOS de estado (en vivo / sin conexión / lecturas nuevas), no cada segundo.
 */
export const LiveBadge: FC<{ lastOkAt: number | null; failing: boolean; added: number; lang: Lang; t: TFn }> = ({ lastOkAt, failing, added, lang, t }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now()); }, 1000);
    return () => clearInterval(id);
  }, []);
  if (lastOkAt === null) return null;
  const { unit, n } = ageParts(now - lastOkAt);
  const age = t(unit === 's' ? 'sensors.live.age.s' : unit === 'min' ? 'sensors.live.age.min' : 'sensors.live.age.h', { n });
  return (
    <div className={s.liveBox}>
      <span className={failing ? `${s.live} ${s.liveOff}` : s.live}>
        <span className={s.liveDot} aria-hidden="true" />
        <strong>{failing ? t('sensors.live.offline', { age }) : t('sensors.live.on')}</strong>
        {!failing && <span>· {t('sensors.live.updated', { age })}</span>}
      </span>
      {added > 0 && <span className={s.liveAdded}>{t('sensors.live.added', { n: formatNumber(added, lang, 0) })}</span>}
      <span className={s.sr} role="status">{failing ? t('sensors.live.offlineShort') : t('sensors.live.onShort')}</span>
      <span className={s.sr} role="status">{added > 0 ? t('sensors.live.added', { n: formatNumber(added, lang, 0) }) : ''}</span>
    </div>
  );
};
