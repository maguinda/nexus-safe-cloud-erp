import { useEffect, useState } from 'react';
import { errorText } from '../i18n/server';
import type { TFn } from '../i18n';
import type { Api } from '../lib/api';
import type { ReadingsQuery } from '../lib/types';
import type { ReadingsLoad } from '../components/sensors/ReadingsTable';
import { useAlive } from './useAlive';

/** La página de lecturas que pide la consulta; se vuelve a pedir solo si cambia lo que se pide, o al reintentar. */
export function useReadings(api: Api, t: TFn, query: ReadingsQuery, enabled: boolean): { load: ReadingsLoad; retry: () => void } {
  const alive = useAlive();
  const [load, setLoad] = useState<ReadingsLoad>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(query); // la consulta serializada: la identidad del objeto cambia en cada render
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    setLoad({ status: 'loading' });
    api.telemetryReadings(query).then(
      (page) => { if (!stale && alive.current) setLoad({ status: 'ready', page }); },
      (e) => { if (!stale && alive.current) setLoad({ status: 'error', message: errorText(e, t, 'sensors.table.error') }); },
    );
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, enabled, key, nonce, t]);
  return { load, retry: () => setNonce((n) => n + 1) };
}
