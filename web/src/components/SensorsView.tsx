import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { windowLabel } from '../lib/telemetry';
import { formatNumber } from '../charts/format';
import { useFocusWhenReady } from '../hooks/useFocusWhenReady';
import { useReadings } from '../hooks/useReadings';
import { useSensorsData } from '../hooks/useSensorsData';
import { buildCards, DEFAULT_RANGE, explorerReducer, INITIAL_STATE, slotLabeler, toQuery, type SensorFilters } from '../lib/sensors';
import type { RangeKey } from '../lib/types';
import { addedSince } from '../lib/sensors-live';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { Cards } from './sensors/Cards';
import { Charts } from './sensors/Charts';
import { FilterBar } from './sensors/FilterBar';
import { Insights } from './sensors/Insights';
import { LiveBadge } from './sensors/LiveBadge';
import { RangeBar } from './sensors/RangeBar';
import { ReadingsTable } from './sensors/ReadingsTable';
import s from './sensors/Sensors.module.css';

/**
 * Sensores: los datos IoT de la docente para el gerente. Arriba, los hallazgos (reglas sobre los datos, cada una con su evidencia); luego las cifras con contexto,
 * los filtros, los gráficos y la tabla de lecturas. Un hallazgo o un «Ver detalle» APLICA su filtro a la tabla y lleva el foco allí.
 */
export function SensorsView() {
  const { api, lang, t } = useSession();
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const { data, error, switching, reload, live } = useSensorsData(api, t, range);
  const [state, dispatch] = useReducer(explorerReducer, INITIAL_STATE);
  const window = data?.trends.window ?? data?.facets.window ?? null;
  const rangeNow = data?.trends.range ?? null;
  const slotLabel = useMemo(() => slotLabeler(rangeNow, lang), [rangeNow?.from, rangeNow?.to, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = useMemo(() => toQuery(state, window), [state, window]);
  // El total de lecturas guardadas: cuando cambia, la tabla se actualiza (o avisa) y el indicador cuenta las nuevas desde que se abrió la pantalla.
  const liveTotal = data ? data.facets.statuses.reduce((n, x) => n + x.count, 0) : 0;
  const firstTotal = useRef<number | null>(null);
  if (data && firstTotal.current === null) firstTotal.current = liveTotal;
  const { load, retry, newer } = useReadings(api, t, query, data !== null, liveTotal);
  const focus = useFocusWhenReady(load.status === 'ready');
  const show = useCallback((filters: Partial<SensorFilters>) => { focus.request(); dispatch({ type: 'apply', filters }); }, [focus]);

  if (!data) {
    return error
      ? <div className={ui.panelError} role="alert"><strong>{t('sensors.unavailable')}</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={reload}>{t('sensors.retry')}</button></div>
      : <p className={ui.muted} role="status">{t('sensors.loading')}</p>;
  }
  const { trends, facets } = data;
  const total = liveTotal;
  if (total === 0) return <section aria-labelledby="sensors-h"><h2 id="sensors-h" className={ui.h2}>{t('sensors.title')}</h2><p className={ui.muted}>{t('sensors.empty')}</p></section>;
  const cards = buildCards(trends, state.filters.location);
  const multiDay = trends.range !== null && Date.parse(trends.range.to) - Date.parse(trends.range.from) > 36 * 3_600_000;

  return (
    <div className={s.stack}>
      <div className={s.head}>
        <h2 id="sensors-h" className={ui.h2}>{t('sensors.title')}</h2>
        <LiveBadge lastOkAt={live.lastOkAt} failing={live.failing} added={addedSince(firstTotal.current, liveTotal)} lang={lang} t={t} />
        <p className={s.sub}>{t('sensors.subtitle', { offices: formatNumber(facets.locations.length, lang, 0), readings: formatNumber(total, lang, 0), window: windowLabel(window, lang) })}</p>
      </div>
      <RangeBar value={range} busy={switching} onPick={setRange} t={t} />
      {error && <div className={ui.panelError} role="alert"><strong>{t('sensors.unavailable')}</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={reload}>{t('sensors.retry')}</button></div>}
      <Insights insights={trends.insights} facets={facets} window={window} withDate={multiDay} lang={lang} t={t} onView={show} />
      <Cards cards={cards} facets={facets} location={state.filters.location} range={trends.range} window={window} bucketMinutes={trends.bucketMinutes} lang={lang} t={t} onDetail={show} />
      <FilterBar filters={state.filters} facets={facets} window={window} dispatch={dispatch} lang={lang} t={t} />
      <Charts trends={trends} location={state.filters.location} slotLabel={slotLabel} lang={lang} t={t} />
      <ReadingsTable load={load} state={state} dispatch={dispatch} headingRef={focus.ref} onRetry={retry} newer={newer} onLatest={state.page === 0 ? retry : () => dispatch({ type: 'page', page: 0 })} lang={lang} t={t} />
    </div>
  );
}
