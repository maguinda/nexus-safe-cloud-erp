import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../i18n/server';
import type { NotificationsPage } from '../lib/types';
import { useSession } from '../session';
import { useAlive } from './useAlive';

const POLL_MS = 15_000;
const PAGE = 20;
const MAX = 100; // el tope del servidor: pedir más da 400

/**
 * Los avisos de la persona: el contador se pregunta cada 15 s MIENTRAS la pestaña se ve (y al volver a verla);
 * la lista se carga solo cuando se abre la campana.
 */
export function useNotifications(open: boolean) {
  const { api, t } = useSession();
  const alive = useAlive();
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState<NotificationsPage | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState('');

  const refreshCount = useCallback(async () => {
    try { const r = await api.notificationsUnread(); if (alive.current) setUnread(r.unread); } catch { /* el contador se reintenta solo; no molesta con un error */ }
  }, [api, alive]);

  const loadList = useCallback(async (n: number) => {
    try {
      const r = await api.notifications({ limit: n });
      if (!alive.current) return;
      setPage(r); setUnread(r.unread); setError('');
    } catch (e) { if (alive.current) setError(errorText(e, t, 'server.unexpected')); }
  }, [api, alive, t]);

  useEffect(() => {
    void refreshCount();
    const tick = () => { if (document.visibilityState === 'visible') void (open ? loadList(limit) : refreshCount()); };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [refreshCount, loadList, open, limit]);

  useEffect(() => { if (open) void loadList(limit); }, [open, limit, loadList]);

  const markRead = useCallback(async (id: string) => {
    try { await api.notificationRead(id); await loadList(limit); } catch (e) { if (alive.current) setError(errorText(e, t, 'server.unexpected')); }
  }, [api, alive, loadList, limit, t]);

  const markAll = useCallback(async () => {
    try { await api.notificationsReadAll(); await loadList(limit); } catch (e) { if (alive.current) setError(errorText(e, t, 'server.unexpected')); }
  }, [api, alive, loadList, limit, t]);

  return { unread, page, error, markRead, markAll, showMore: () => setLimit((n) => Math.min(n + PAGE, MAX)) };
}
