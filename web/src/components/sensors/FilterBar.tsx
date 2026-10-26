import type { Dispatch, FC } from 'react';
import { formatNumber } from '../../charts/format';
import type { MsgKey, TFn } from '../../i18n';
import type { Lang } from '../../i18n/core';
import { activeFilters, clampTime, hasFilters, timeMarks, type DataWindow, type ExplorerAction, type SensorFilters } from '../../lib/sensors';
import type { Severity, TelemetryFacets } from '../../lib/types';
import s from './Sensors.module.css';

const SEVERITIES: Severity[] = ['normal', 'warning', 'alert'];
const FILTER_LABEL: Record<keyof SensorFilters, MsgKey> = {
  location: 'sensors.filter.office', deviceKind: 'sensors.filter.kind', severity: 'sensors.filter.severity', status: 'sensors.filter.status', from: 'sensors.filter.from', to: 'sensors.filter.to',
};

/** Un grupo de botones «uno u ninguno» (aria-pressed): pulsar el activo lo quita. Los valores salen de lo que hay en los datos, nunca se escriben a mano. */
const Choice: FC<{ legend: string; value: string; options: { value: string; label: string; count?: string }[]; onPick: (v: string) => void }> = ({ legend, value, options, onPick }) => (
  <fieldset className={s.group}>
    <legend>{legend}</legend>
    <div className={s.chips}>
      {options.map((o) => (
        <button key={o.value} type="button" className={s.chip} aria-pressed={value === o.value} onClick={() => onPick(value === o.value ? '' : o.value)}>
          {o.label}{o.count && <span className={s.chipCount}>{o.count}</span>}
        </button>
      ))}
    </div>
  </fieldset>
);

/** Filtros de la pantalla (noValidate: no hay nada que se escriba libremente salvo la hora, que se lleva a la ventana de datos). */
export const FilterBar: FC<{ filters: SensorFilters; facets: TelemetryFacets; window: DataWindow | null; dispatch: Dispatch<ExplorerAction>; lang: Lang; t: TFn }> = ({ filters, facets, window, dispatch, lang, t }) => {
  const set = (key: keyof SensorFilters) => (value: string) => dispatch({ type: 'set', key, value });
  const label = (key: keyof SensorFilters, value: string) => (key === 'severity' ? t(`sensors.severity.${value}` as MsgKey) : value);
  const chips = activeFilters(filters);
  const marks = timeMarks(window);
  const moreOpen = filters.deviceKind !== '' || filters.status !== '';
  const time = (key: 'from' | 'to', text: string) => (
    <label className={s.timeField}>
      {text}
      <input type="time" className={s.timeInput} value={filters[key]} list="sensors-marks" onChange={(e) => set(key)(clampTime(e.target.value, window))} />
    </label>
  );
  return (
    <form noValidate onSubmit={(e) => e.preventDefault()} aria-label={t('sensors.filter.title')}>
      <fieldset className={s.filters}>
        <legend>{t('sensors.filter.title')}</legend>
        <div className={s.filterRow}>
          <Choice legend={t('sensors.filter.office')} value={filters.location} options={facets.locations.map((l) => ({ value: l, label: l }))} onPick={set('location')} />
          <Choice legend={t('sensors.filter.severity')} value={filters.severity} options={SEVERITIES.map((v) => ({ value: v, label: t(`sensors.severity.${v}` as MsgKey) }))} onPick={set('severity')} />
          <div className={s.filterRow}>{time('from', t('sensors.filter.from'))}{time('to', t('sensors.filter.to'))}</div>
          <datalist id="sensors-marks">{marks.map((m) => <option key={m} value={m} />)}</datalist>
        </div>
        <details className={s.more} open={moreOpen}>
          <summary>{t('sensors.filter.more')}</summary>
          <div className={s.moreBody}>
            <Choice legend={t('sensors.filter.kind')} value={filters.deviceKind} options={facets.deviceKinds.map((k) => ({ value: k, label: k }))} onPick={set('deviceKind')} />
            <Choice legend={t('sensors.filter.status')} value={filters.status} options={facets.statuses.map((x) => ({ value: x.status, label: x.status, count: formatNumber(x.count, lang, 0) }))} onPick={set('status')} />
          </div>
        </details>
        <p className={s.hint}>{t('sensors.filter.hint')}</p>
        {hasFilters(filters) && (
          <div className={s.activeRow} role="group" aria-label={t('sensors.filter.active')}>
            {chips.map((c) => {
              const name = `${t(FILTER_LABEL[c.key])}: ${label(c.key, c.value)}`;
              return <button key={c.key} type="button" className={s.activeChip} onClick={() => dispatch({ type: 'remove', key: c.key })} aria-label={t('sensors.filter.remove', { name })}>{name} ✕</button>;
            })}
            <button type="button" className={s.chip} onClick={() => dispatch({ type: 'clear' })}>{t('sensors.filter.clear')}</button>
          </div>
        )}
      </fieldset>
    </form>
  );
};
