import { useCallback, useEffect, useState } from 'react';
import type { Api } from '../lib/api';
import type { NetworkFacets, NetworkLinkItem, NetworkSummary } from '../lib/types';
import { useAlive } from './useAlive';

/** Resumen y opciones de filtro de Red; los enlaces aparte, porque solo alimentan un gráfico y su fallo no debe tumbar la pantalla. */
export function useNetworkData(api: Api) {
  const alive = useAlive();
  const [summary, setSummary] = useState<NetworkSummary | null>(null);
  const [facets, setFacets] = useState<NetworkFacets | null>(null);
  const [links, setLinks] = useState<NetworkLinkItem[] | null>(null);
  const [linksError, setLinksError] = useState(false);
  const [cause, setCause] = useState<unknown>(null);
  const reload = useCallback(async () => {
    try {
      const [sm, fc] = await Promise.all([api.networkSummary(), api.networkFacets()]);
      if (!alive.current) return;
      setSummary(sm); setFacets(fc); setCause(null);
    } catch (e) { if (alive.current) setCause(e); }
    api.networkLinks({ limit: 200 }).then((p) => { if (alive.current) { setLinks(p.items); setLinksError(false); } }, () => { if (alive.current) setLinksError(true); });
  }, [api, alive]);
  useEffect(() => { void reload(); }, [reload]);
  return { summary, facets, links, linksError, cause, reload: () => void reload() };
}
