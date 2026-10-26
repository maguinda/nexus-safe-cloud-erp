import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../i18n/server';
import type { Api } from '../lib/api';
import type { TFn } from '../i18n';
import type { TelemetryFacets, Trends } from '../lib/types';
import { useAlive } from './useAlive';

/** Las tendencias y las opciones de filtro de Sensores, con su error y el reintento. */
export function useSensorsData(api: Api, t: TFn): { data: { trends: Trends; facets: TelemetryFacets } | null; error: string; reload: () => void } {
  const alive = useAlive();
  const [data, setData] = useState<{ trends: Trends; facets: TelemetryFacets } | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setError('');
    try {
      const [trends, facets] = await Promise.all([api.telemetryTrends(), api.telemetryFacets()]);
      if (alive.current) setData({ trends, facets });
    } catch (e) { if (alive.current) setError(errorText(e, t, 'sensors.loadError')); }
  }, [api, t, alive]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload: () => void reload() };
}
