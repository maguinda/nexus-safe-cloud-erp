import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { formatCop, timeAgo } from '../lib/format';
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

  if (denied) {
    return (
      <div className={ui.panelError} role="alert">
        <strong>403 Forbidden</strong>
        <span>Your role ({user?.role}) cannot read invoices. The API checks the role on every request, not only the menu.</span>
      </div>
    );
  }
  if (error) return <div className={ui.panelError} role="alert"><strong>Something went wrong</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>Try again</button></div>;

  return (
    <section aria-labelledby="inv-h" className={s.stack}>
      <h2 id="inv-h" className={ui.h2}>Invoices</h2>
      <div className={ui.scroll}>
        <table className={ui.table}>
          <caption className={s.sr}>Invoices, newest first</caption>
          <thead><tr><th>Invoice</th><th>Project</th><th>Milestone</th><th className={ui.num}>Amount (COP)</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            {(invoices ?? []).map((i) => (
              <tr key={i.number}>
                <td className={ui.mono}>{i.number}</td>
                <td>{i.projectName}</td>
                <td>{i.milestoneName}</td>
                <td className={ui.num}>{formatCop(i.amountCop)}</td>
                <td><span className={ui[i.status]}>{i.status === 'draft' ? 'Draft' : 'Issued'}</span></td>
                <td className={ui.muted}>{timeAgo(i.createdAt, now)}</td>
                <td>{i.status === 'draft' && user?.role === 'billing_analyst'
                  ? <button type="button" className={ui.btnGhost} disabled={busy === i.number} onClick={() => void issue(i.number)}>{busy === i.number ? 'Issuing…' : 'Issue invoice'}</button>
                  : <span className={ui.muted}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={ui.muted}>A draft shows up a moment after a milestone is approved. The “Created” column says how fresh each row is.</p>
    </section>
  );
}
