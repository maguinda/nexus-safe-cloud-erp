import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { AddMilestoneForm, NewProjectForm } from './CreateForms';
import { formatCop } from '../lib/format';
import type { Invoice, Milestone, Project } from '../lib/types';
import { ROLE_LABEL } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './ProjectsView.module.css';

interface Flow { milestone: string; project: string; approvedMs: number; invoice: Invoice | null; invoiceMs: number | null; timedOut: boolean }

export function ProjectsView({ toast }: { toast: (m: string) => void }) {
  const { api, user } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Record<string, Milestone[]>>({});
  const [selected, setSelected] = useState('');
  const [drafts, setDrafts] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [flow, setFlow] = useState<Flow | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const ps = await api.projects();
      const ms = await Promise.all(ps.map((p) => api.milestones(p.id)));
      let draftCount: number | null = null;
      try { draftCount = (await api.invoices()).filter((i) => i.status === 'draft').length; } catch (e) { if (!(e instanceof ApiError && e.status === 403)) throw e; }
      if (!alive.current) return;
      setProjects(ps);
      setMilestones(Object.fromEntries(ps.map((p, i) => [p.id, ms[i]])));
      setDrafts(draftCount);
      setSelected((cur) => cur || ps[0]?.id || '');
      setError('');
    } catch (e) {
      if (alive.current) setError(e instanceof ApiError ? e.message : 'We could not load the projects. Check your connection.');
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function approve(m: Milestone, projectName: string) {
    setBusyId(m.id);
    const t0 = Date.now();
    try {
      await api.approve(m.id);
      const approvedMs = Date.now() - t0;
      setFlow({ milestone: m.name, project: projectName, approvedMs, invoice: null, invoiceMs: null, timedOut: false });
      void load();
      // La factura la crea Billing después, por evento: se consulta hasta que aparezca (máx. 15 s).
      while (alive.current && Date.now() - t0 < 15_000) {
        await new Promise((r) => setTimeout(r, 400));
        const found = (await api.invoices()).find((i) => i.status === 'draft' && i.milestoneName === m.name && i.projectName === projectName && Date.parse(i.createdAt) >= t0 - 2000);
        if (found) {
          if (alive.current) { setFlow((f) => (f ? { ...f, invoice: found, invoiceMs: Date.now() - t0 } : f)); toast(`Billing created draft ${found.number}`); void load(); }
          return;
        }
      }
      if (alive.current) setFlow((f) => (f ? { ...f, timedOut: true } : f));
    } catch (e) {
      toast(e instanceof ApiError ? (e.status === 409 ? 'That milestone was already approved.' : e.message) : 'The approval did not go through. Try again.');
      void load();
    } finally {
      if (alive.current) setBusyId('');
    }
  }

  if (error) return <div className={ui.panelError} role="alert"><strong>Something went wrong</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>Try again</button></div>;
  const sel = projects.find((p) => p.id === selected);
  const pending = Object.values(milestones).flat().filter((m) => m.status === 'pending').length;
  const canApprove = user?.role === 'project_lead';
  const canCreate = canApprove; // crear proyectos e hitos también es del project_lead (la API lo exige)

  return (
    <div className={s.stack}>
      <div className={ui.kpis}>
        <div className={ui.card}><small className={ui.muted}>Active projects</small><strong className={ui.kpi}>{projects.length}</strong></div>
        <div className={ui.card}><small className={ui.muted}>Milestones pending approval</small><strong className={ui.kpi}>{pending}</strong></div>
        <div className={ui.card}><small className={ui.muted}>Draft invoices</small><strong className={ui.kpi}>{drafts ?? '—'}</strong></div>
      </div>

      {canCreate && <NewProjectForm api={api} onCreated={(p) => { setSelected(p.id); toast(`Project “${p.name}” created`); void load(); }} />}

      <section aria-labelledby="proj-h">
        <h2 id="proj-h" className={ui.h2}>Projects</h2>
        <div className={ui.scroll}>
          <table className={ui.table}>
            <caption className={s.sr}>Projects and how many milestones are approved. Select a row to see its milestones.</caption>
            <thead><tr><th>Project</th><th>Client</th><th className={ui.num}>Milestones approved</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className={p.id === selected ? s.selected : s.row}>
                  <td><button type="button" className={s.rowBtn} aria-pressed={p.id === selected} onClick={() => setSelected(p.id)}>{p.name}</button></td>
                  <td className={ui.muted}>{p.client}</td>
                  <td className={ui.num}>{p.milestonesApproved} / {p.milestonesTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {sel && (
        <section aria-labelledby="ms-h">
          <h2 id="ms-h" className={ui.h2}>Milestones · {sel.name}</h2>
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead><tr><th>Milestone</th><th className={ui.num}>Amount (COP)</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {(milestones[sel.id] ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className={ui.num}>{formatCop(m.amountCop)}</td>
                    <td><span className={ui[m.status]}>{m.status === 'approved' ? 'Approved' : 'Pending'}</span></td>
                    <td>
                      {m.status === 'approved' ? <span className={ui.muted}>Done</span>
                        : canApprove ? <button type="button" className={ui.btn} disabled={busyId === m.id} onClick={() => void approve(m, sel.name)}>{busyId === m.id ? 'Approving…' : 'Approve milestone'}</button>
                        : <span className={ui.muted}>Read only for {user ? ROLE_LABEL[user.role] : ''}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canCreate && sel && <AddMilestoneForm api={api} project={sel} onCreated={(m) => { toast(`Milestone “${m.name}” added`); void load(); }} />}

      <section className={ui.card} aria-labelledby="flow-h" aria-live="polite">
        <h2 id="flow-h" className={ui.h2}>What happens after “Approve milestone”</h2>
        <ol className={s.flow}>
          <li className={flow ? s.done : s.wait}><span className={s.dot} aria-hidden />Projects saves the milestone and the event in one transaction and answers <b>200 OK</b>.{flow && <span className={ui.mono}> {flow.approvedMs} ms</span>}</li>
          <li className={flow?.invoice ? s.done : s.wait}><span className={s.dot} aria-hidden />The event travels through RabbitMQ.</li>
          <li className={flow?.invoice ? s.done : s.wait}><span className={s.dot} aria-hidden />Billing creates a <b>draft invoice</b>.{flow?.invoice && <span className={ui.mono}> {flow.invoice.number} · {flow.invoiceMs} ms after approving</span>}{flow?.timedOut && !flow.invoice && <span className={ui.mono}> Still waiting for Billing…</span>}</li>
        </ol>
      </section>
    </div>
  );
}
