import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { windowLabel } from '../lib/telemetry';
import { formatNumber } from '../charts/format';
import { errorText } from '../i18n/server';
import { buildCards, explorerReducer, INITIAL_STATE, toQuery, type SensorFilters } from '../lib/sensors';
import type { TelemetryFacets, Trends } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { Cards } from './sensors/Cards';
import { Charts } from './sensors/Charts';
import { FilterBar } from './sensors/FilterBar';
import { Insights } from './sensors/Insights';
import { ReadingsTable, type ReadingsLoad } from './sensors/ReadingsTable';
import s from './sensors/Sensors.module.css';

/**
 * Sensores: los datos IoT de la docente para el gerente. Arriba, los hallazgos (reglas sobre los datos, cada una con su evidencia); luego las cifras con contexto,
 * los filtros, los gráficos y la tabla de lecturas. Un hallazgo o un «Ver detalle» APLICA su filtro a la tabla y lleva el foco allí.
 */
export function SensorsView() {
  const { api, lang, t } = useSession();
  const [data, setData] = useState<{ trends: Trends; facets: TelemetryFacets } | null>(null);
  const [error, setError] = useState('');
  const [state, dispatch] = useReducer(explorerReducer, INITIAL_STATE);
  const [load, setLoad] = useState<ReadingsLoad>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTable = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const loadAll = useCallback(async () => {
    setError('');
    try {
      const [trends, facets] = await Promise.all([api.telemetryTrends(), api.telemetryFacets()]);
      if (alive.current) setData({ trends, facets });
    } catch (e) { if (alive.current) setError(errorText(e, t, 'sensors.loadError')); }
  }, [api, t]);
  useEffect(() => { void loadAll(); }, [loadAll]);

  const window = data?.trends.window ?? data?.facets.window ?? null;
  const query = useMemo(() => toQuery(state, window), [state, window]);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    if (!data) return;
    let stale = false;
    setLoad({ status: 'loading' });
    api.telemetryReadings(query).then(
      (page) => { if (!stale && alive.current) setLoad({ status: 'ready', page }); },
      (e) => { if (!stale && alive.current) setLoad({ status: 'error', message: errorText(e, t, 'sensors.table.error') }); },
    );
    return () => { stale = true; };
    // `queryKey` es la consulta serializada: se vuelve a pedir solo cuando cambia lo que se pide (o al reintentar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, data, queryKey, reload, t]);

  // Tras aplicar un filtro desde un hallazgo o una tarjeta, el foco va al título de la tabla cuando ya hay resultados (así se lee el contador).
  useEffect(() => {
    if (focusTable.current && load.status === 'ready') { focusTable.current = false; heading.current?.focus(); heading.current?.scrollIntoView({ block: 'start' }); }
  }, [load]);
  const show = useCallback((filters: Partial<SensorFilters>) => { focusTable.current = true; dispatch({ type: 'apply', filters }); }, []);

  if (!data) {
    return error
      ? <div className={ui.panelError} role="alert"><strong>{t('sensors.unavailable')}</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void loadAll()}>{t('sensors.retry')}</button></div>
      : <p className={ui.muted} role="status">{t('sensors.loading')}</p>;
  }
  const { trends, facets } = data;
  const total = facets.statuses.reduce((n, x) => n + x.count, 0);
  if (total === 0) return <section aria-labelledby="sensors-h"><h2 id="sensors-h" className={ui.h2}>{t('sensors.title')}</h2><p className={ui.muted}>{t('sensors.empty')}</p></section>;
  const cards = buildCards(trends, facets, state.filters.location);

  return (
    <div className={s.stack}>
      <div className={s.head}>
        <h2 id="sensors-h" className={ui.h2}>{t('sensors.title')}</h2>
        <p className={s.sub}>{t('sensors.subtitle', { offices: formatNumber(facets.locations.length, lang, 0), readings: formatNumber(total, lang, 0), window: windowLabel(window, lang) })}</p>
      </div>
      <Insights insights={trends.insights} facets={facets} lang={lang} t={t} onView={show} />
      <Cards cards={cards} facets={facets} location={state.filters.location} window={window} bucketMinutes={trends.bucketMinutes} lang={lang} t={t} onDetail={show} />
      <FilterBar filters={state.filters} facets={facets} window={window} dispatch={dispatch} lang={lang} t={t} />
      <Charts trends={trends} facets={facets} location={state.filters.location} lang={lang} t={t} />
      <ReadingsTable load={load} state={state} dispatch={dispatch} headingRef={heading} onRetry={() => setReload((n) => n + 1)} lang={lang} t={t} />
    </div>
  );
}
