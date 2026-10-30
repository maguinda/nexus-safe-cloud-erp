import { useCallback, useEffect, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import type { PurchaseOrder, RestockSuggestion, StockItem, Supplier } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import { StockHistory } from './StockHistory';
import { AdjustForm, NewItemForm, NewOrderForm, NewSupplierForm } from './ProcurementForms';
import s from './ProcurementView.module.css';

interface Data { suppliers: Supplier[]; items: StockItem[]; orders: PurchaseOrder[]; suggestions: RestockSuggestion[] }

/** Compras e inventario (US-08): lo consultan gerencia, líder de proyecto y facturación; solo gerencia compra, recibe y ajusta. */
export function ProcurementView({ toast }: { toast: (m: string) => void }) {
  const { api, user, t } = useSession();
  const alive = useAlive();
  const isManager = user?.role === 'manager';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [suppliers, items, orders, suggestions] = await Promise.all([api.suppliers(), api.inventory(), api.orders(), api.suggestions()]);
      if (alive.current) { setData({ suppliers, items, orders, suggestions }); setError(''); }
    } catch (e) { if (alive.current) setError(errorText(e, t, 'server.unexpected')); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, work: () => Promise<string>) => {
    if (busy) return;
    setBusy(id);
    try { toast(await work()); await load(); } catch (e) { toast(t('proc.saveFailed', { reason: errorText(e, t, 'server.unexpected') })); await load(); } finally { if (alive.current) setBusy(''); }
  };

  if (error) return <div className={ui.panelError} role="alert"><strong>{t('proc.loadError', { reason: error })}</strong><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('proc.retry')}</button></div>;
  return (
    <section aria-labelledby="proc-h" className={s.stack}>
      <h2 id="proc-h" className={ui.h2}>{t('proc.title')}</h2>
      <p className={ui.muted}>{t('proc.intro')}{!isManager && ` ${t('proc.readOnly')}`}</p>
      {data === null ? <p role="status" className={ui.muted}>{t('proc.loading')}</p> : (
        <>
          <div className={s.card}>
            <h3>{t('proc.suggest.title')}</h3>
            {data.suggestions.length === 0 ? <p className={ui.muted}>{t('proc.suggest.empty')}</p> : (
              <ul className={s.list}>
                {data.suggestions.slice(0, 5).map((x) => (
                  <li key={x.eventId} className={`${s.row} ${s.alert}`}>
                    <span className={s.grow}>
                      {t('proc.suggest.line', { device: x.deviceName, location: x.location, kind: x.readingKind, value: String(x.value), unit: x.unit, status: x.status })}
                      <span className={s.sub}>{x.items.length ? t('proc.suggest.parts', { parts: x.items.map((i) => `${i.name} (${i.onHand})`).join(', ') }) : t('proc.suggest.noParts')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={s.card} aria-labelledby="proc-stock-h" role="region">
            <h3 id="proc-stock-h">{t('proc.stock.title')}</h3>
            <ul className={s.list}>
              {data.items.map((i) => (
                <li key={i.id} className={s.row} data-item={i.name}>
                  <span className={s.grow}>
                    <strong>{i.name}</strong>
                    <span className={s.sub}>{t(i.kind === 'equipment' ? 'proc.kind.equipment' : 'proc.kind.spare')} · {t('proc.stock.col.for')}: {i.forKinds.length ? i.forKinds.join(', ') : t('proc.none')}</span>
                  </span>
                  <span className={i.onHand === 0 ? s.low : undefined}>{t('proc.stock.col.onHand')}: {i.onHand}</span>
                  {isManager && adjusting !== i.id && <button type="button" className={ui.btnGhost} aria-label={t('proc.adjustFor', { name: i.name })} onClick={() => setAdjusting(i.id)}>{t('proc.adjust')}</button>}
                  {isManager && adjusting === i.id && <AdjustForm api={api} item={i} onCancel={() => setAdjusting(null)} onDone={(m) => { setAdjusting(null); toast(m); void load(); }} />}
                </li>
              ))}
            </ul>
          </div>

          <div className={s.card} role="region" aria-labelledby="proc-ord-h">
            <h3 id="proc-ord-h">{t('proc.orders.title')}</h3>
            {data.orders.length === 0 ? <p className={ui.muted}>{t('proc.orders.empty')}</p> : (
              <ul className={s.list}>
                {data.orders.slice(0, 30).map((o) => (
                  <li key={o.id} className={s.row} data-order={o.number}>
                    <span className={s.grow}>{t('proc.orders.line', { number: o.number, item: o.itemName, quantity: o.quantity, supplier: o.supplierName, total: formatCop(o.totalCop) })}</span>
                    <strong className={`${s.status} ${o.status === 'received' ? s.statusReceived : o.status === 'cancelled' ? s.statusCancelled : ''}`}>{t(`proc.orders.status.${o.status}` as 'proc.orders.status.ordered')}</strong>
                    {isManager && o.status === 'ordered' && (
                      <>
                        <button type="button" className={ui.btn} disabled={!!busy} aria-label={t('proc.orders.receiveLabel', { number: o.number })} onClick={() => void act(o.id, async () => { const r = await api.receiveOrder(o.id); return t('proc.orders.received', { number: o.number, item: o.itemName, onHand: r.onHand }); })}>{t('proc.orders.receive')}</button>
                        <button type="button" className={ui.btnGhost} disabled={!!busy} aria-label={t('proc.orders.cancelLabel', { number: o.number })} onClick={() => void act(o.id, async () => { await api.cancelOrder(o.id); return t('proc.orders.cancelled'); })}>{t('proc.orders.cancel')}</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={s.card} role="region" aria-labelledby="proc-sup-h">
            <h3 id="proc-sup-h">{t('proc.suppliers.title')}</h3>
            {data.suppliers.length === 0 ? <p className={ui.muted}>{t('proc.suppliers.empty')}</p> : (
              <ul className={s.list}>
                {data.suppliers.map((p) => (
                  <li key={p.id} className={s.row}>
                    <span className={s.grow}><strong>{p.name}</strong> · {t(p.kind === 'fixed' ? 'proc.kind.fixed' : 'proc.kind.tender')}{p.terms && <span className={s.sub}>{t('proc.suppliers.terms', { terms: p.terms })}</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isManager && (
            <div className={s.cols}>
              <NewOrderForm api={api} suppliers={data.suppliers} items={data.items} onCreated={(n) => { toast(t('proc.orders.created', { number: n })); void load(); }} />
              <NewItemForm api={api} onCreated={(name) => { toast(t('proc.created', { name })); void load(); }} />
              <NewSupplierForm api={api} onCreated={(name) => { toast(t('proc.created', { name })); void load(); }} />
            </div>
          )}
        </>
      )}
      {data && <StockHistory items={data.items} refreshKey={data.items.map((x) => x.onHand).join(',')} />}
    </section>
  );
}
