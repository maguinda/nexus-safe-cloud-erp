import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAlive } from '../hooks/useAlive';
import { errorText } from '../i18n/server';
import { checkContract, STATUS_KEY } from '../lib/contracts';
import type { ContractErrors } from '../lib/contracts';
import { formatCop } from '../lib/format';
import type { Contract, Project } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';

const EMPTY = { clientName: '', projectName: '', amountCop: '', startDate: '', endDate: '' };

/** Contratos con el cliente (FR-BIL-01): los ven gerencia, facturación y líder de proyecto; crean y cierran gerencia y facturación. */
export function ContractsView({ toast }: { toast: (m: string) => void }) {
  const { api, user, t } = useSession();
  const alive = useAlive();
  const canWrite = user?.role === 'manager' || user?.role === 'billing_analyst';
  const [rows, setRows] = useState<Contract[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<ContractErrors & { form?: string }>({});
  const [busy, setBusy] = useState('');
  // Los proyectos salen de Projects: se elige uno (queda enlazado por su id) y el cliente se completa solo.
  const [projects, setProjects] = useState<Project[] | null>(null);
  useEffect(() => { let live = true; api.projects().then((p) => { if (live) setProjects(p); }).catch(() => { if (live) setProjects(null); }); return () => { live = false; }; }, [api]);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    try { const r = await api.contracts(); if (alive.current) { setRows(r); setError(''); } } catch (e) { if (alive.current) setError(errorText(e, t, 'server.unexpected')); }
  }, [api, alive, t]);
  useEffect(() => { void load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (inflight.current) return;
    const { errors: errs, value } = checkContract(t, f, projects);
    setErrors(errs);
    if (!value) return;
    inflight.current = true; setBusy('new');
    try { await api.createContract(value); toast(t('con.saved', { client: value.clientName })); setOpen(false); setF(EMPTY); }
    catch (err) { setErrors({ form: t('con.failed', { reason: errorText(err, t, 'server.unexpected') }) }); }
    finally { inflight.current = false; setBusy(''); await load(); }
  }
  async function change(c: Contract, status: 'closed' | 'cancelled') {
    if (inflight.current) return;
    inflight.current = true; setBusy(c.id);
    try { await api.setContractStatus(c.id, status); toast(t('con.changed')); }
    catch (err) { toast(t('con.failed', { reason: errorText(err, t, 'server.unexpected') })); }
    finally { inflight.current = false; setBusy(''); await load(); }
  }

  return (
    <section aria-labelledby="con-h">
      <h2 id="con-h" className={ui.h2}>{t('con.title')}</h2>
      <p className={ui.muted}>{t('con.intro')}</p>
      {error && <p className={ui.panelError} role="alert">{error}</p>}
      {canWrite && !open && <p><button type="button" className={ui.btn} onClick={() => { setOpen(true); setErrors({}); }}>{t('con.new')}</button></p>}
      {open && (
        <form onSubmit={(e) => void create(e)} noValidate aria-label={t('con.new')} className={ui.formCard}>
          <div className={ui.formGrid}>
            <label className={ui.field}><span>{t('con.field.client')}</span><input type="text" autoComplete="off" maxLength={160} value={f.clientName} onChange={(x) => setF({ ...f, clientName: x.target.value })} aria-invalid={!!errors.clientName} />{errors.clientName && <span className={ui.err}>{errors.clientName}</span>}</label>
            <label className={ui.field}><span>{t('con.field.project')}</span><input type="text" autoComplete="off" maxLength={160} list={projects ? 'con-projects' : undefined} value={f.projectName} onChange={(x) => { const name = x.target.value; const p = projects?.find((q) => q.name === name); setF({ ...f, projectName: name, ...(p && !f.clientName ? { clientName: p.client } : {}) }); }} aria-invalid={!!errors.projectName} />{projects && <datalist id="con-projects">{projects.map((p) => <option key={p.id} value={p.name} />)}</datalist>}{projects && <span className={ui.muted}>{t('con.field.projectHint')}</span>}{errors.projectName && <span className={ui.err}>{errors.projectName}</span>}</label>
            <label className={ui.field}><span>{t('con.field.amount')}</span><input type="text" inputMode="numeric" autoComplete="off" maxLength={12} value={f.amountCop} onChange={(x) => setF({ ...f, amountCop: x.target.value })} aria-invalid={!!errors.amountCop} />{errors.amountCop && <span className={ui.err}>{errors.amountCop}</span>}</label>
            <label className={ui.field}><span>{t('con.field.start')}</span><input type="date" value={f.startDate} onChange={(x) => setF({ ...f, startDate: x.target.value })} aria-invalid={!!errors.startDate} />{errors.startDate && <span className={ui.err}>{errors.startDate}</span>}</label>
            <label className={ui.field}><span>{t('con.field.end')}</span><input type="date" value={f.endDate} onChange={(x) => setF({ ...f, endDate: x.target.value })} aria-invalid={!!errors.endDate} />{errors.endDate && <span className={ui.err}>{errors.endDate}</span>}</label>
          </div>
          {errors.form && <p className={ui.err} role="alert">{errors.form}</p>}
          <div className={ui.formActions}>
            <button type="submit" className={ui.btn} disabled={busy === 'new'}>{busy === 'new' ? t('con.saving') : t('con.save')}</button>
            <button type="button" className={ui.btnGhost} onClick={() => setOpen(false)}>{t('con.cancel')}</button>
          </div>
        </form>
      )}
      {rows === null ? <p className={ui.muted} role="status">…</p> : rows.length === 0 ? <p className={ui.muted}>{t('con.empty')}</p> : (
        <div className={ui.scroll}>
          <table className={ui.table}>
            <caption className="sr-only">{t('con.title')}</caption>
            <thead><tr><th>{t('con.col.client')}</th><th>{t('con.col.project')}</th><th className={ui.num}>{t('con.col.amount')}</th><th className={ui.num}>{t('con.col.billed')}</th><th className={ui.num}>{t('con.col.paid')}</th><th>{t('con.col.term')}</th><th>{t('con.col.status')}</th>{canWrite && <th>{t('con.col.actions')}</th>}</tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} data-contract={c.projectName}>
                  <td data-label={t('con.col.client')}>{c.clientName}</td>
                  <td data-label={t('con.col.project')}>{c.projectName}</td>
                  <td data-label={t('con.col.amount')} className={ui.num}>{formatCop(c.amountCop)}</td>
                  <td data-label={t('con.col.billed')} className={ui.num}>{formatCop(c.billedCop)}</td>
                  <td data-label={t('con.col.paid')} className={ui.num}>{formatCop(c.paidCop)}</td>
                  <td data-label={t('con.col.term')}>{c.startDate} → {c.endDate}</td>
                  <td data-label={t('con.col.status')}>{t(STATUS_KEY[c.status])}</td>
                  {canWrite && <td data-label={t('con.col.actions')}>{c.status === 'active' ? (
                    <>
                      <button type="button" className={ui.btnGhost} disabled={busy === c.id} aria-label={t('con.closeFor', { client: c.clientName, project: c.projectName })} onClick={() => void change(c, 'closed')}>{t('con.close')}</button>{' '}
                      <button type="button" className={ui.btnGhost} disabled={busy === c.id} aria-label={t('con.cancelFor', { client: c.clientName, project: c.projectName })} onClick={() => void change(c, 'cancelled')}>{t('con.cancelContract')}</button>
                    </>
                  ) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
