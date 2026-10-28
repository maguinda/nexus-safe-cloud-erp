import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { formatCop, formatDay, timeAgo } from '../lib/format';
import { pageOf } from '../lib/paging';
import { countByStatus, dueChip, dueState, filterInvoices, INVOICE_PAGE, sortInvoices } from '../lib/invoice-table';
import type { SortDir, SortKey, StatusFilter } from '../lib/invoice-table';
import { errorText } from '../i18n/server';
import type { MsgKey } from '../i18n';
import type { Invoice } from '../lib/types';
import { roleKey } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './InvoicesView.module.css';

/** Solo en teléfono: las columnas pasan a tarjetas y sin encabezados no hay dónde pulsar para ordenar; estos botones hacen lo mismo. */
const SORT_CHIPS: [SortKey, MsgKey][] = [['created', 'invoices.col.created'], ['total', 'invoices.chip.total'], ['due', 'invoices.col.due'], ['number', 'invoices.col.invoice'], ['project', 'invoices.col.project']];

export function InvoicesView({ toast }: { toast: (m: string) => void }) {
  const { api, user, t, lang } = useSession();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [denied, setDenied] = useState('');
  // Se guarda la causa y no el texto: así, si la persona cambia de idioma con el error a la vista, el aviso se vuelve a escribir en el idioma nuevo.
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'created', dir: 'desc' }); // como antes: la más nueva primero
  const [shown, setShown] = useState(INVOICE_PAGE);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const list = await api.invoices();
      if (alive.current) { setInvoices(list); setError(null); setDenied(''); }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 403) setDenied(e.message);
      else setError({ cause: e });
    }
  }, [api]);

  useEffect(() => {
    void load();
    // Se actualiza sola: una factura nueva aparece unos segundos después de aprobar un hito. Con la pestaña oculta no se pide nada
    // (nadie la mira y cada petición gasta el límite del servicio); al volver, se actualiza de inmediato.
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 4000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);
  useEffect(() => { setShown(INVOICE_PAGE); }, [status, query, sort]); // al cambiar el filtro o el orden se vuelve a la primera tanda

  async function issue(n: string) {
    setBusy(n);
    try { await api.issue(n); toast(t('invoices.toast.issued', { n })); await load(); }
    catch (e) { toast(e instanceof ApiError && e.status === 409 ? t('invoices.toast.notDraft', { n }) : errorText(e, t, 'invoices.toast.issueFailed')); await load(); }
    finally { if (alive.current) setBusy(''); }
  }

  function sortBy(key: SortKey) {
    setSort((c) => (c.key === key ? { key, dir: c.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'created' || key === 'total' ? 'desc' : 'asc' }));
  }
  const header = (key: SortKey, labelKey: MsgKey, num = false) => {
    const label = t(labelKey);
    return (
    <th className={num ? ui.num : undefined} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={ui.sortBtn} onClick={() => sortBy(key)} aria-label={t('invoices.sortBy', { label })}>
        {label}<span aria-hidden="true">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
    );
  };

  if (denied) {
    return (
      <div className={ui.panelError} role="alert">
        <strong>{t('invoices.denied.title')}</strong>
        <span>{t('invoices.denied.body', { role: user ? t(roleKey(user.role)) : '' })}</span>
      </div>
    );
  }
  if (error) return <div className={ui.panelError} role="alert"><strong>{t('invoices.error.title')}</strong><span>{errorText(error.cause, t, 'invoices.error.load')}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('invoices.error.retry')}</button></div>;

  const all = invoices ?? [];
  const counts = countByStatus(all);
  const visible = sortInvoices(filterInvoices(all, { status, query }), sort.key, sort.dir);
  const filtered = status !== 'all' || query.trim() !== '';
  const { rows, hidden } = pageOf(visible, shown);
  const clear = () => { setStatus('all'); setQuery(''); };
  const tabs: [StatusFilter, MsgKey][] = [['all', 'invoices.tab.all'], ['draft', 'invoices.tab.draft'], ['issued', 'invoices.tab.issued']];

  return (
    <section aria-labelledby="inv-h" className={s.stack}>
      <h2 id="inv-h" className={ui.h2}>{t('invoices.title')}</h2>
      {invoices === null ? <p role="status" className={ui.muted}>{t('invoices.loading')}</p> : all.length === 0 ? (
        <div className={s.empty}><strong>{t('invoices.empty.title')}</strong><span className={ui.muted}>{t('invoices.empty.hint')}</span></div>
      ) : (
        <>
          <div className={ui.toolbar}>
            <label className={`${ui.field} ${ui.search}`}>
              <span className={s.sr}>{t('invoices.search.label')}</span>
              <input id="inv-search" type="search" maxLength={120} placeholder={t('invoices.search.placeholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className={ui.seg} role="group" aria-label={t('invoices.filter.label')}>
              {tabs.map(([k, labelKey]) => (
                <button key={k} type="button" className={status === k ? ui.segBtnOn : ui.segBtn} aria-pressed={status === k} onClick={() => setStatus(k)}>{t(labelKey)} ({counts[k]})</button>
              ))}
            </div>
            <div className={s.sortChips} role="group" aria-label={t('invoices.sortCards.label')}>
              {SORT_CHIPS.map(([k, labelKey]) => (
                <button key={k} type="button" className={sort.key === k ? ui.segBtnOn : ui.segBtn} aria-pressed={sort.key === k} aria-label={t('invoices.sortBy', { label: t(labelKey) })} onClick={() => sortBy(k)}>
                  {t(labelKey)}<span aria-hidden="true">{sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                </button>
              ))}
            </div>
            <span className={s.count} role="status">{t('invoices.showing', { shown: rows.length, total: all.length })}</span>
          </div>
          {visible.length === 0 ? (
            <div className={s.empty} role="status"><strong>{t('invoices.noMatch')}</strong><button type="button" className={ui.btnGhost} onClick={clear}>{t('invoices.clearFilters')}</button></div>
          ) : (
            <div className={ui.scrollTall}>
              <table className={`${ui.tableDense} ${ui.cardsOnPhone} ${s.invCards}`}>
                <caption className={s.sr}>{t(filtered ? 'invoices.captionFiltered' : 'invoices.caption', { key: t(`invoices.key.${sort.key}`), dir: t(sort.dir === 'asc' ? 'invoices.dir.asc' : 'invoices.dir.desc') })}</caption>
                <thead><tr>{header('number', 'invoices.col.invoice')}{header('project', 'invoices.col.project')}<th>{t('invoices.col.milestone')}</th><th className={ui.num}>{t('invoices.col.subtotal')}</th><th className={ui.num}>{t('invoices.col.iva')}</th>{header('total', 'invoices.col.total', true)}<th>{t('invoices.col.status')}</th>{header('due', 'invoices.col.due')}{header('created', 'invoices.col.created')}<th>{t('invoices.col.action')}</th></tr></thead>
                <tbody>
                  {rows.map((i) => {
                    const due = dueState(i.dueDate, now);
                    const chip = dueChip(due, t);
                    return (
                      <tr key={i.number}>
                        <td className={ui.mono}>{i.number}</td>
                        <td data-label={t('invoices.col.project')}>{i.projectName}</td>
                        <td data-label={t('invoices.col.milestone')}>{i.milestoneName}</td>
                        <td className={ui.num} data-label={t('invoices.col.subtotal')}>{formatCop(i.amountCop)}</td>
                        <td className={ui.num} data-label={t('invoices.col.iva')}>{formatCop(i.taxCop)}</td>
                        <td className={ui.num} data-label={t('invoices.col.total')}><strong>{formatCop(i.totalCop)}</strong></td>
                        <td data-label={t('invoices.col.status')}><span className={ui[i.status]}>{t(i.status === 'draft' ? 'invoices.status.draft' : 'invoices.status.issued')}</span></td>
                        <td data-label={t('invoices.col.due')}>{i.dueDate ? (
                          <span className={s.dueCell}>
                            <span className={ui.muted}>{formatDay(i.dueDate, lang)}</span>
                            {chip && <span className={due.state === 'overdue' ? ui.overdue : ui.soon}>{chip}</span>}
                          </span>
                        ) : <span className={ui.muted}>—</span>}</td>
                        <td className={ui.muted} data-label={t('invoices.col.created')}>{timeAgo(i.createdAt, now, t)}</td>
                        <td data-label={t('invoices.col.action')}>{i.status === 'draft' && user?.role === 'billing_analyst'
                          ? <button type="button" className={ui.btnGhost} disabled={busy === i.number} onClick={() => void issue(i.number)}>{busy === i.number ? t('invoices.action.issuing') : t('invoices.action.issue')}</button>
                          : <span className={ui.muted}>—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {hidden > 0 && <button type="button" className={`${ui.btnGhost} ${s.more}`} onClick={() => setShown((n) => n + INVOICE_PAGE)}>{t('invoices.showMore', { n: Math.min(INVOICE_PAGE, hidden) })}</button>}
        </>
      )}
      <p className={ui.muted}>{t('invoices.note', { created: t('invoices.col.created') })}</p>
    </section>
  );
}
