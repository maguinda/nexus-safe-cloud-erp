import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { formatCop, formatDay, timeAgo } from '../lib/format';
import { countByStatus, dueState, filterInvoices, sortInvoices } from '../lib/invoice-table';
import type { SortDir, SortKey, StatusFilter } from '../lib/invoice-table';
import type { Invoice } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './InvoicesView.module.css';

export function InvoicesView({ toast }: { toast: (m: string) => void }) {
  const { api, user } = useSession();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [denied, setDenied] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'created', dir: 'desc' }); // como antes: la más nueva primero
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const list = await api.invoices();
      if (alive.current) { setInvoices(list); setError(''); setDenied(''); }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 403) setDenied(e.message);
      else setError(e instanceof ApiError ? e.message : 'We could not load the invoices. Check your connection.');
    }
  }, [api]);

  useEffect(() => {
    void load();
    // Se actualiza sola: una factura nueva aparece unos segundos después de aprobar un hito.
    const poll = setInterval(() => void load(), 4000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  async function issue(n: string) {
    setBusy(n);
    try { await api.issue(n); toast(`${n} issued`); await load(); }
    catch (e) { toast(e instanceof ApiError ? (e.status === 409 ? `${n} is not a draft anymore.` : e.message) : 'The invoice could not be issued. Try again.'); await load(); }
    finally { if (alive.current) setBusy(''); }
  }

  function sortBy(key: SortKey) {
    setSort((c) => (c.key === key ? { key, dir: c.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'created' || key === 'total' ? 'desc' : 'asc' }));
  }
  const header = (key: SortKey, label: string, num = false) => (
    <th className={num ? ui.num : undefined} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={ui.sortBtn} onClick={() => sortBy(key)} aria-label={`Sort by ${label}`}>
        {label}<span aria-hidden="true">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );

  if (denied) {
    return (
      <div className={ui.panelError} role="alert">
        <strong>403 Forbidden</strong>
        <span>Your role ({user?.role}) cannot read invoices. The API checks the role on every request, not only the menu.</span>
      </div>
    );
  }
  if (error) return <div className={ui.panelError} role="alert"><strong>Something went wrong</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>Try again</button></div>;

  const all = invoices ?? [];
  const counts = countByStatus(all);
  const visible = sortInvoices(filterInvoices(all, { status, query }), sort.key, sort.dir);
  const filtered = status !== 'all' || query.trim() !== '';
  const clear = () => { setStatus('all'); setQuery(''); };
  const tabs: [StatusFilter, string][] = [['all', 'All'], ['draft', 'Draft'], ['issued', 'Issued']];

  return (
    <section aria-labelledby="inv-h" className={s.stack}>
      <h2 id="inv-h" className={ui.h2}>Invoices</h2>
      {invoices === null ? <p role="status" className={ui.muted}>Loading invoices…</p> : all.length === 0 ? (
        <div className={s.empty}><strong>No invoices yet</strong><span className={ui.muted}>A draft appears a moment after a milestone is approved.</span></div>
      ) : (
        <>
          <div className={s.toolbar}>
            <label className={`${ui.field} ${s.search}`}>
              <span className={s.sr}>Search invoices</span>
              <input id="inv-search" type="search" maxLength={120} placeholder="Search invoice, project or milestone" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className={s.seg} role="group" aria-label="Filter by status">
              {tabs.map(([k, label]) => (
                <button key={k} type="button" className={status === k ? s.segBtnOn : s.segBtn} aria-pressed={status === k} onClick={() => setStatus(k)}>{label} ({counts[k]})</button>
              ))}
            </div>
            <span className={s.count} role="status">Showing {visible.length} of {all.length}</span>
          </div>
          {visible.length === 0 ? (
            <div className={s.empty} role="status"><strong>No invoices match these filters</strong><button type="button" className={ui.btnGhost} onClick={clear}>Clear filters</button></div>
          ) : (
            <div className={ui.scrollTall}>
              <table className={ui.tableDense}>
                <caption className={s.sr}>Invoices, sorted by {sort.key} ({sort.dir === 'asc' ? 'ascending' : 'descending'}){filtered ? ', filtered' : ''}</caption>
                <thead><tr>{header('number', 'Invoice')}{header('project', 'Project')}<th>Milestone</th><th className={ui.num}>Subtotal (COP)</th><th className={ui.num}>IVA 19 %</th>{header('total', 'Total (COP)', true)}<th>Status</th>{header('due', 'Due')}{header('created', 'Created')}<th>Action</th></tr></thead>
                <tbody>
                  {visible.map((i) => {
                    const due = dueState(i.dueDate, now);
                    return (
                      <tr key={i.number}>
                        <td className={ui.mono}>{i.number}</td>
                        <td>{i.projectName}</td>
                        <td>{i.milestoneName}</td>
                        <td className={ui.num}>{formatCop(i.amountCop)}</td>
                        <td className={ui.num}>{formatCop(i.taxCop)}</td>
                        <td className={ui.num}><strong>{formatCop(i.totalCop)}</strong></td>
                        <td><span className={ui[i.status]}>{i.status === 'draft' ? 'Draft' : 'Issued'}</span></td>
                        <td>{i.dueDate ? (
                          <span className={s.dueCell}>
                            <span className={ui.muted}>{formatDay(i.dueDate)}</span>
                            {due.state === 'overdue' && <span className={ui.overdue}>Overdue {Math.abs(due.days as number)} d</span>}
                            {due.state === 'soon' && <span className={ui.soon}>{due.days === 0 ? 'Due today' : `In ${due.days} d`}</span>}
                          </span>
                        ) : <span className={ui.muted}>—</span>}</td>
                        <td className={ui.muted}>{timeAgo(i.createdAt, now)}</td>
                        <td>{i.status === 'draft' && user?.role === 'billing_analyst'
                          ? <button type="button" className={ui.btnGhost} disabled={busy === i.number} onClick={() => void issue(i.number)}>{busy === i.number ? 'Issuing…' : 'Issue invoice'}</button>
                          : <span className={ui.muted}>—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <p className={ui.muted}>A draft shows up a moment after a milestone is approved. The “Created” column says how fresh each row is.</p>
    </section>
  );
}
