import type { FC } from 'react';
import type { MsgKey, TFn } from '../../i18n';
import { RANGE_KEYS } from '../../lib/sensors';
import type { RangeKey } from '../../lib/types';
import s from './Sensors.module.css';

/** El rango de tiempo de las cifras, los hallazgos y los gráficos: siempre hay uno elegido (24 horas al abrir). */
export const RangeBar: FC<{ value: RangeKey; busy: boolean; onPick: (r: RangeKey) => void; t: TFn }> = ({ value, busy, onPick, t }) => (
  <fieldset className={s.group} aria-busy={busy}>
    <legend>{t('sensors.range.legend')}</legend>
    <div className={s.chips}>
      {RANGE_KEYS.map((k) => (
        <button key={k} type="button" className={s.chip} aria-pressed={value === k} onClick={() => onPick(k)}>
          {t(`sensors.range.${k}` as MsgKey)}
        </button>
      ))}
    </div>
    <p className={s.rangeHint}>{t('sensors.range.hint')}</p>
  </fieldset>
);
