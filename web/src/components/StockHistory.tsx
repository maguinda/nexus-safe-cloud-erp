import { useCallback, useEffect, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatInstant } from '../lib/format';
import type { StockItem, StockMovement } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import h from './StockHistory.module.css';

/** Historial de movimientos de stock: cuándo, qué artículo, cuánto subió o bajó, cómo quedó y quién lo hizo. Solo se lee; el servidor lo escribe al mover el stock. */
export function StockHistory({ items, refreshKey }: { items: StockItem[]; refreshKey: unknown }) {
  const { api, t, lang } = useSession();
  const alive = useAlive();
  const [itemId, setItemId] = useState('');
  const [rows, setRows] = useState<StockMovement[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const r = await api.stockMovements(itemId || undefined); if (alive.current) { setRows(r); setError(''); } } catch (e) { if (alive.current) setError(t('hist.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, itemId, t]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const source = (s: string) => (s === 'opening' ? t('hist.src.opening') : s === 'purchase_received' ? t('hist.src.purchase') : t('hist.src.adjustment'));
  return (
    <section aria-labelledby="hist-h">
      <h3 id="hist-h" className={ui.h2}>{t('hist.title')}</h3>
      <p className={ui.muted}>{t('hist.intro')}</p>
      {error && <p className={ui.panelError} role="alert">{error}</p>}
      <div className={h.filters} role="group" aria-label={t('hist.filter')}>
        <button type="button" className={itemId === '' ? ui.segBtnOn : ui.segBtn} aria-pressed={itemId === ''} onClick={() => setItemId('')}>{t('hist.all')}</button>
        {items.map((i) => <button key={i.id} type="button" className={itemId === i.id ? ui.segBtnOn : ui.segBtn} aria-pressed={itemId === i.id} onClick={() => setItemId(i.id)}>{i.name}</button>)}
      </div>
      {rows === null ? <p className={ui.muted} role="status">…</p> : rows.length === 0 ? <p className={ui.muted}>{t('hist.empty')}</p> : (
        <div className={ui.scroll}>
          <table className={`${ui.table} ${ui.cardsOnPhone}`}>
            <caption className="sr-only">{t('hist.title')}</caption>
            <thead><tr><th>{t('hist.col.when')}</th><th>{t('hist.col.item')}</th><th className={ui.num}>{t('hist.col.change')}</th><th className={ui.num}>{t('hist.col.after')}</th><th>{t('hist.col.what')}</th><th>{t('hist.col.who')}</th></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id} data-movement={m.source}>
                <td data-label={t('hist.col.when')}>{formatInstant(m.at, lang)}</td>
                <td data-label={t('hist.col.item')}>{m.itemName}</td>
                <td data-label={t('hist.col.change')} className={ui.num}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                <td data-label={t('hist.col.after')} className={ui.num}>{m.onHandAfter}</td>
                <td data-label={t('hist.col.what')}>{source(m.source)} · {m.reason}</td>
                <td data-label={t('hist.col.who')}>{m.actor ?? t('hist.noActor')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
