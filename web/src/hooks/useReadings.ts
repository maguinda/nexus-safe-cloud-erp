import { useEffect, useRef, useState } from 'react';
import { errorText } from '../i18n/server';
import type { TFn } from '../i18n';
import type { Api } from '../lib/api';
import { tableRefresh } from '../lib/sensors-live';
import type { ReadingsQuery } from '../lib/types';
import type { ReadingsLoad } from '../components/sensors/ReadingsTable';
import { useAlive } from './useAlive';

/**
 * La página de lecturas que pide la consulta; se vuelve a pedir si cambia lo que se pide, al reintentar y, EN SILENCIO, cuando `liveKey` (el total de
 * lecturas guardadas) cambia y se está en la primera página. En otra página no se mueve nada: `newer` avisa que llegaron lecturas nuevas.
 */
export function useReadings(api: Api, t: TFn, query: ReadingsQuery, enabled: boolean, liveKey: number | string = ''): { load: ReadingsLoad; retry: () => void; newer: boolean } {
  const alive = useAlive();
  const [load, setLoad] = useState<ReadingsLoad>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const [newer, setNewer] = useState(false);
  const key = JSON.stringify(query); // la consulta serializada: la identidad del objeto cambia en cada render
  const loadedKey = useRef(liveKey); // el total con el que se pidió la página que se ve
  const latestKey = useRef(liveKey);
  latestKey.current = liveKey;
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    setLoad({ status: 'loading' });
    setNewer(false);
    loadedKey.current = latestKey.current;
    api.telemetryReadings(query).then(
      (page) => { if (!stale && alive.current) setLoad({ status: 'ready', page }); },
      (e) => { if (!stale && alive.current) setLoad({ status: 'error', message: errorText(e, t, 'sensors.table.error') }); },
    );
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, enabled, key, nonce, t]);

  useEffect(() => {
    if (!enabled) return;
    const action = tableRefresh({ ready: load.status === 'ready', changed: liveKey !== loadedKey.current, offset: query.offset ?? 0 });
    if (action === 'none') return;
    if (action === 'notice') { setNewer(true); return; }
    let stale = false;
    const before = loadedKey.current;
    loadedKey.current = liveKey;
    api.telemetryReadings(query).then(
      (page) => { if (!stale && alive.current) setLoad({ status: 'ready', page }); },
      // Un refresco en silencio que falla no cambia lo que se ve: queda el aviso para que la persona lo pida a mano.
      () => { if (!stale && alive.current) { loadedKey.current = before; setNewer(true); } },
    );
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);
  return { load, retry: () => setNonce((n) => n + 1), newer };
}
