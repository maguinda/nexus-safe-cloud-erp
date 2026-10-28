import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from '../lib/api';
import { NETWORK_REFRESH_MS } from '../lib/netview';
import { fingerprint } from '../lib/sensors-live';
import type { NetworkFacets, NetworkLinkItem, NetworkSummary } from '../lib/types';
import { useAlive } from './useAlive';

/**
 * Resumen y opciones de filtro de Red; los enlaces aparte, porque solo alimentan un gráfico y su fallo no debe tumbar la pantalla.
 * Se vuelve a pedir solo cada minuto mientras la pestaña se ve (y al volver a ella): en silencio, sin «cargando…», sin repintar si nada cambió, y si falla
 * los datos de antes se quedan con el aviso de que pueden estar atrasados (`cause`), que se quita solo al recuperarse.
 */
export function useNetworkData(api: Api) {
  const alive = useAlive();
  const [summary, setSummary] = useState<NetworkSummary | null>(null);
  const [facets, setFacets] = useState<NetworkFacets | null>(null);
  const [links, setLinks] = useState<NetworkLinkItem[] | null>(null);
  const [linksError, setLinksError] = useState(false);
  const [cause, setCause] = useState<unknown>(null);
  const inflight = useRef(false); // una petición a la vez: si la anterior no terminó, se salta ésta
  const last = useRef('');
  const hasLinks = useRef(false);
  const reload = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const [sm, fc] = await Promise.all([api.networkSummary(), api.networkFacets()]);
      if (!alive.current) return;
      const print = fingerprint(sm, fc);
      if (print !== last.current) { last.current = print; setSummary(sm); setFacets(fc); } // igual que antes: no se repinta nada
      setCause(null);
    } catch (e) { if (alive.current) setCause(e); }
    finally { inflight.current = false; }
    api.networkLinks({ limit: 200 }).then(
      (p) => { if (alive.current) { hasLinks.current = true; setLinks((old) => (JSON.stringify(old) === JSON.stringify(p.items) ? old : p.items)); setLinksError(false); } },
      () => { if (alive.current && !hasLinks.current) setLinksError(true); }, // si ya había enlaces, un fallo de un refresco no los quita
    );
  }, [api, alive]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void reload(); };
    const id = setInterval(tick, NETWORK_REFRESH_MS);
    document.addEventListener('visibilitychange', tick); // al volver a la pestaña se actualiza de inmediato
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [reload]);
  return { summary, facets, links, linksError, cause, reload: () => void reload() };
}
