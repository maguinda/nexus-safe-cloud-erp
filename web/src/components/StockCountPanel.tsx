import { useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { checkCounted } from '../lib/count';
import { formatInstant } from '../lib/format';
import type { StockCount, StockCountLine } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import c from './StockCountPanel.module.css';

/** Conteo físico: gerencia abre (foto del stock esperado), anota lo contado y cierra (la diferencia se aplica como ajuste). El resto de roles solo ve el historial. */
export function StockCountPanel({ onChanged, toast }: { onChanged: () => void; toast: (m: string) => void }) {
  const { api, user, t, lang } = useSession();
  const alive = useAlive();
  const isManager = user?.role === 'manager';
  const [counts, setCounts] = useState<StockCount[] | null>(null);
  const [lines, setLines] = useState<StockCountLine[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const inflight = useRef(false);

  const open = counts?.find((c) => c.status === 'open') ?? null;
  const load = useCallback(async () => {
    try {
      const list = await api.stockCounts();
      const cur = list.find((c) => c.status === 'open');
      const detail = cur ? await api.stockCount(cur.id) : null;
      if (!alive.current) return;
      setCounts(list); setLines(detail?.lines ?? []); setError('');
    } catch (e) { if (alive.current) setError(t('count.loadError', { reason: errorText(e, t, 'server.unexpected') })); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, work: () => Promise<void>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(key);
    try { await work(); } catch (e) { toast(t('count.failed', { reason: errorText(e, t, 'server.unexpected') })); }
    finally { inflight.current = false; setBusy(''); await load(); }
  }
  const saveLine = (l: StockCountLine) => {
    const { error: err, value } = checkCounted(t, drafts[l.itemId] ?? '');
    setErrors((p) => ({ ...p, [l.itemId]: err ?? '' }));
    if (value === undefined || !open) return;
    void act(`l:${l.itemId}`, async () => { await api.setCounted(open.id, l.itemId, value); setDrafts((p) => { const { [l.itemId]: _x, ...rest } = p; return rest; }); });
  };

  const date = (iso: string) => formatInstant(iso, lang);
  return (
    <section aria-labelledby="count-h">
      <h3 id="count-h" className={ui.h2}>{t('count.title')}</h3>
      <p className={ui.muted}>{t('count.intro')}</p>
      {error && <p className={ui.panelError} role="alert">{error}</p>}
      {isManager && !open && counts !== null && (
        <p><button type="button" className={ui.btn} disabled={busy === 'open'} onClick={() => void act('open', async () => { const c = await api.openStockCount(); toast(t('count.opened', { n: c.number })); })}>{t('count.open')}</button></p>
      )}
      {open && (
        <div data-count="open">
          <h4>{t('count.openTitle', { n: open.number, date: date(open.openedAt) })}</h4>
          <div className={ui.scroll}>
            <table className={`${ui.table} ${ui.cardsOnPhone}`}>
              <caption className="sr-only">{t('count.title')}</caption>
              <thead><tr><th>{t('count.col.item')}</th><th className={ui.num}>{t('count.col.expected')}</th><th>{t('count.col.counted')}</th><th className={ui.num}>{t('count.col.variance')}</th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.itemId} data-line={l.itemName}>
                  <td className={c.name}>{l.itemName}</td>
                  <td data-label={t('count.col.expected')} className={ui.num}>{l.expected}</td>
                  <td data-label={t('count.col.counted')}>
                    {isManager ? (
                      <div className={c.cell}>
                        <input className={c.input} type="text" inputMode="numeric" autoComplete="off" maxLength={8} aria-label={t('count.field', { name: l.itemName })} value={drafts[l.itemId] ?? (l.counted === null ? '' : String(l.counted))}
                          onChange={(e) => setDrafts((p) => ({ ...p, [l.itemId]: e.target.value }))} aria-invalid={!!errors[l.itemId]} />
                        <button type="button" className={ui.btnGhost} aria-label={t('count.saveFor', { name: l.itemName })} disabled={busy === `l:${l.itemId}`} onClick={() => saveLine(l)}>{t('count.save')}</button>
                        {errors[l.itemId] && <span className={`${ui.err} ${c.err}`}>{errors[l.itemId]}</span>}
                      </div>
                    ) : (l.counted === null ? t('count.notCounted') : l.counted)}
                  </td>
                  <td data-label={t('count.col.variance')} className={ui.num}>{l.variance === null ? '—' : l.variance > 0 ? `+${l.variance}` : l.variance}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {isManager && (
            <div className={ui.formActions}>
              <button type="button" className={ui.btn} disabled={!!busy} onClick={() => void act('close', async () => { const r = await api.closeStockCount(open.id); toast(t('count.closed', { n: r.count.number, changes: r.adjustments.length })); onChanged(); })}>{t('count.close')}</button>
              <button type="button" className={ui.btnGhost} disabled={!!busy} onClick={() => void act('cancel', async () => { const c = await api.cancelStockCount(open.id); toast(t('count.cancelled', { n: c.number })); })}>{t('count.cancel')}</button>
            </div>
          )}
        </div>
      )}
      <h4>{t('count.history')}</h4>
      {counts === null ? <p className={ui.muted} role="status">…</p> : counts.filter((c) => c.status !== 'open').length === 0 ? <p className={ui.muted}>{t('count.empty')}</p> : (
        <ul>{counts.filter((c) => c.status !== 'open').map((c) => <li key={c.id} data-past={c.number}>{t('count.row', { n: c.number, status: t(`count.status.${c.status}` as 'count.status.closed'), date: date(c.closedAt ?? c.openedAt), diff: c.differences, total: c.lines })}</li>)}</ul>
      )}
    </section>
  );
}
