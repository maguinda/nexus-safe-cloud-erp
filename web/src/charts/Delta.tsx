import s from './charts.module.css';
import { formatPercent } from './format';
import { changePct } from './scale';
import { resolveT, type I18nProps } from './types';

export interface DeltaProps extends I18nProps {
  /** Valor anterior y actual: la variación se calcula aquí (null si el anterior es 0 o falta). Alternativa: `pct` ya calculado. */
  previous?: number | null;
  current?: number | null;
  pct?: number | null;
  /** Qué sentido es BUENO: 'up' (subir es bueno, p. ej. facturación), 'down' (bajar es bueno) o 'neutral' (sin juicio, p. ej. lecturas). Una temperatura que sube es mala: goodWhen="down". */
  goodWhen?: 'up' | 'down' | 'neutral';
  /** Por debajo de este % absoluto se considera «sin cambio». */
  flatBelow?: number;
  /** Si se pone, se muestra también «frente al periodo anterior». */
  showVs?: boolean;
}

/** Chip de variación ▲ ▼ ▬ con el porcentaje. El sentido es por ICONO Y TEXTO además del color. */
export function Delta({ previous, current, pct, goodWhen = 'up', flatBelow = 0.05, showVs, ...i18n }: DeltaProps) {
  const { lang, t } = resolveT(i18n);
  const value = pct !== undefined ? pct : changePct(previous, current);
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={`${s.delta} ${s.deltaNeutral}`} aria-label={t('chart.delta.none')}>—</span>;
  const flat = Math.abs(value) < flatBelow;
  const up = value > 0;
  const good = flat || goodWhen === 'neutral' ? null : goodWhen === 'up' ? up : !up;
  const cls = good === null ? s.deltaNeutral : good ? s.deltaGood : s.deltaBad;
  const text = formatPercent(Math.abs(value), lang);
  const spoken = flat ? t('chart.delta.flat') : t(up ? 'chart.delta.up' : 'chart.delta.down', { value: text });
  return (
    <span className={`${s.delta} ${cls}`} aria-label={showVs ? `${spoken} ${t('chart.delta.vs')}` : spoken}>
      <span aria-hidden>{flat ? '▬' : up ? '▲' : '▼'}</span>
      <span aria-hidden>{flat ? '0' : text}</span>
      {showVs && <span aria-hidden className={s.deltaVs}>{t('chart.delta.vs')}</span>}
    </span>
  );
}
