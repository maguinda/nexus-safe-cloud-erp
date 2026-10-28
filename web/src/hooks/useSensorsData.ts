import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../i18n/server';
import type { Api } from '../lib/api';
import type { TFn } from '../i18n';
import { fingerprint, SENSORS_REFRESH_MS } from '../lib/sensors-live';
import type { TelemetryFacets, Trends } from '../lib/types';
import { useAlive } from './useAlive';

/**
 * Las tendencias y las opciones de filtro de Sensores, con su error y el reintento. Se actualizan solas cada 10 s mientras la pestaña se ve (y de
 * inmediato al volver a ella): en silencio, sin «cargando…», y los datos de antes se quedan si un refresco falla (`live.failing`).
 */
export function useSensorsData(api: Api, t: TFn): { data: { trends: Trends; facets: TelemetryFacets } | null; error: string; reload: () => void; live: { lastOkAt: number | null; failing: boolean } } {
  const alive = useAlive();
  const [data, setData] = useState<{ trends: Trends; facets: TelemetryFacets } | null>(null);
  const [error, setError] = useState('');
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [failing, setFailing] = useState(false);
  const inflight = useRef(false); // un refresco a la vez: si el anterior no terminó, se salta este
  const last = useRef('');
  const run = useCallback(async (silent: boolean) => {
    if (inflight.current) return;
    inflight.current = true;
    if (!silent) setError('');
    try {
      const [trends, facets] = await Promise.all([api.telemetryTrends(), api.telemetryFacets()]);
      if (!alive.current) return;
      const print = fingerprint(trends, facets);
      if (print !== last.current) { last.current = print; setData({ trends, facets }); } // igual que antes: no se vuelve a pintar nada
      setError('');
      setFailing(false);
      setLastOkAt(Date.now());
    } catch (e) {
      if (!alive.current) return;
      if (silent) setFailing(true); else setError(errorText(e, t, 'sensors.loadError'));
    } finally { inflight.current = false; }
  }, [api, t, alive]);
  useEffect(() => { void run(false); }, [run]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void run(true); };
    const id = setInterval(tick, SENSORS_REFRESH_MS);
    document.addEventListener('visibilitychange', tick); // al volver a la pestaña se actualiza de inmediato
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [run]);
  return { data, error, reload: () => void run(false), live: { lastOkAt, failing } };
}
