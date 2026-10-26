import type { MsgKey, TFn } from '../../i18n';
import { critKey } from '../../lib/netview';
import s from './network.module.css';

/** Etiqueta de criticidad: el nombre en el idioma de la persona (Crítica/Critical…), con el tono de estado correspondiente. Un valor que no es de las tres se muestra tal cual. */
export function CritChip({ value, t }: { value: string; t: TFn }) {
  const k = critKey(value);
  const cls = value === 'Crítica' ? s.crit : value === 'Alta' ? s.critHigh : s.critMid;
  return <span className={cls}>{k ? t(k as MsgKey) : value}</span>;
}
