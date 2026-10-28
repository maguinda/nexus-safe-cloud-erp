import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { AddMilestoneForm, NewProjectForm } from './CreateForms';
import { errorText } from '../i18n/server';
import { formatCop } from '../lib/format';
import { filterProjects, pageOf, pendingMilestones, PROJECT_PAGE } from '../lib/project-table';
import type { Invoice, Milestone, Project } from '../lib/types';
import { roleKey } from '../lib/types';
import { useSession } from '../session';
import ui from '../styles/ui.module.css';
import s from './ProjectsView.module.css';

interface Flow { milestone: string; project: string; approvedMs: number; invoice: Invoice | null; invoiceMs: number | null; timedOut: boolean }

export function ProjectsView({ toast }: { toast: (m: string) => void }) {
  const { api, user, t } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [msFor, setMsFor] = useState(''); // de qué proyecto son los hitos que hay en pantalla: nunca se muestran bajo otro título
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PROJECT_PAGE);
  const [drafts, setDrafts] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [flow, setFlow] = useState<Flow | null>(null);
  const alive = useRef(true);
  const selectedRef = useRef('');
  const msReq = useRef(0); // la última petición de hitos gana: una respuesta lenta de otro proyecto se descarta
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const loadProjects = useCallback(async () => {
    try {
      const ps = await api.projects();
      let draftCount: number | null = null;
      try { draftCount = (await api.invoices()).filter((i) => i.status === 'draft').length; } catch (e) { if (!(e instanceof ApiError && e.status === 403)) throw e; }
      if (!alive.current) return;
      setProjects(ps);
      setDrafts(draftCount);
      setSelected((cur) => cur || ps[0]?.id || '');
      setError('');
    } catch (e) {
      if (alive.current) setError(errorText(e, t, 'projects.loadError'));
    }
  }, [api, t]);

  // Solo se piden los hitos del proyecto elegido (antes eran una petición por cada proyecto en cada carga).
  const loadMilestones = useCallback(async (id: string) => {
    if (!id) return;
    const req = ++msReq.current;
    try {
      const ms = await api.milestones(id);
      if (!alive.current || req !== msReq.current) return;
      setMilestones(ms);
      setMsFor(id);
      setError('');
    } catch (e) {
      if (alive.current && req === msReq.current) setError(errorText(e, t, 'projects.loadError'));
    }
  }, [api, t]);

  const load = useCallback(() => Promise.all([loadProjects(), loadMilestones(selectedRef.current)]), [loadProjects, loadMilestones]);
  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadMilestones(selected); }, [selected, loadMilestones]);

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
          if (alive.current) { setFlow((f) => (f ? { ...f, invoice: found, invoiceMs: Date.now() - t0 } : f)); toast(t('projects.billingCreatedDraft', { number: found.number })); void load(); }
          return;
        }
      }
      if (alive.current) setFlow((f) => (f ? { ...f, timedOut: true } : f));
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t('projects.alreadyApproved') : errorText(e, t, 'projects.approveFailed'));
      void load();
    } finally {
      if (alive.current) setBusyId('');
    }
  }

  // Todos los hooks van ANTES del return de error: si no, al aparecer un error cambiaría su número (React #300).
  const filtered = useMemo(() => filterProjects(projects, query), [projects, query]);

  if (error) return <div className={ui.panelError} role="alert"><strong>{t('projects.somethingWrong')}</strong><span>{error}</span><button type="button" className={ui.btnGhost} onClick={() => void load()}>{t('projects.tryAgain')}</button></div>;
  const sel = projects.find((p) => p.id === selected);
  const pending = pendingMilestones(projects);
  const { rows, hidden } = pageOf(filtered, shown);
  const msReady = sel !== undefined && msFor === sel.id;
  const canApprove = user?.role === 'project_lead';
  const canCreate = canApprove; // crear proyectos e hitos también es del project_lead (la API lo exige)

  return (
    <div className={s.stack}>
      <div className={ui.kpis}>
        <div className={ui.card}><small className={ui.muted}>{t('projects.kpi.active')}</small><strong className={ui.kpi}>{projects.length}</strong></div>
        <div className={ui.card}><small className={ui.muted}>{t('projects.kpi.pending')}</small><strong className={ui.kpi}>{pending}</strong></div>
        <div className={ui.card}><small className={ui.muted}>{t('projects.kpi.drafts')}</small><strong className={ui.kpi}>{drafts ?? '—'}</strong></div>
      </div>

      {canCreate && <NewProjectForm api={api} onCreated={(p) => { setSelected(p.id); toast(t('projects.created', { name: p.name })); void load(); }} />}

      <section aria-labelledby="proj-h">
        <h2 id="proj-h" className={ui.h2}>{t('projects.title')}</h2>
        <div className={ui.toolbar}>
          <label className={`${ui.field} ${ui.search}`}>
            <span className={s.sr}>{t('projects.search.label')}</span>
            <input id="proj-search" type="search" maxLength={120} placeholder={t('projects.search.placeholder')} value={query} onChange={(e) => { setQuery(e.target.value); setShown(PROJECT_PAGE); }} />
          </label>
          <span className={s.count} role="status">{t('projects.count', { shown: rows.length, total: filtered.length })}</span>
        </div>
        <div className={ui.scroll}>
          <table className={ui.table}>
            <caption className={s.sr}>{t('projects.caption')}</caption>
            <thead><tr><th>{t('projects.col.project')}</th><th>{t('projects.col.client')}</th><th className={ui.num}>{t('projects.col.approved')}</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.id === selected ? s.selected : s.row} onClick={() => setSelected(p.id)}>
                  <td><button type="button" className={s.rowBtn} aria-pressed={p.id === selected} onClick={() => setSelected(p.id)}>{p.name}</button></td>
                  <td className={ui.muted}>{p.client}</td>
                  <td className={ui.num}>{p.milestonesApproved} / {p.milestonesTotal}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={3} className={ui.muted}>{t('projects.noMatch')}</td></tr>}
            </tbody>
          </table>
        </div>
        {hidden > 0 && <button type="button" className={`${ui.btnGhost} ${s.more}`} onClick={() => setShown((n) => n + PROJECT_PAGE)}>{t('projects.showMore', { n: Math.min(PROJECT_PAGE, hidden) })}</button>}
      </section>

      {sel && (
        <section aria-labelledby="ms-h">
          <h2 id="ms-h" className={ui.h2}>{t('projects.milestonesTitle', { name: sel.name })}</h2>
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead><tr><th>{t('projects.col.milestone')}</th><th className={ui.num}>{t('projects.col.amount')}</th><th>{t('projects.col.status')}</th><th>{t('projects.col.action')}</th></tr></thead>
              <tbody>
                {!msReady && <tr><td colSpan={4} className={ui.muted}>{t('projects.loadingMilestones')}</td></tr>}
                {msReady && milestones.length === 0 && <tr><td colSpan={4} className={ui.muted}>{t('projects.noMilestones')}</td></tr>}
                {msReady && milestones.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className={ui.num}>{formatCop(m.amountCop)}</td>
                    <td><span className={ui[m.status]}>{m.status === 'approved' ? t('projects.status.approved') : t('projects.status.pending')}</span></td>
                    <td>
                      {m.status === 'approved' ? <span className={ui.muted}>{t('projects.done')}</span>
                        : canApprove ? <button type="button" className={ui.btn} disabled={busyId === m.id} onClick={() => void approve(m, sel.name)}>{busyId === m.id ? t('projects.approving') : t('projects.approve')}</button>
                        : <span className={ui.muted}>{t('projects.readOnly', { role: user ? t(roleKey(user.role)) : '' })}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canCreate && sel && <AddMilestoneForm api={api} project={sel} onCreated={(m) => { toast(t('projects.milestoneAdded', { name: m.name })); void load(); }} />}

      <section className={ui.card} aria-labelledby="flow-h" aria-live="polite">
        <h2 id="flow-h" className={ui.h2}>{t('projects.flow.title')}</h2>
        <ol className={s.flow}>
          <li className={flow ? s.done : s.wait}><span className={s.dot} aria-hidden />{t('projects.flow.saveA')}<b>{t('projects.flow.saveB')}</b>{t('projects.flow.saveC')}{flow && <span className={ui.mono}> {flow.approvedMs} ms</span>}</li>
          <li className={flow?.invoice ? s.done : s.wait}><span className={s.dot} aria-hidden />{t('projects.flow.rabbit')}</li>
          <li className={flow?.invoice ? s.done : s.wait}><span className={s.dot} aria-hidden />{t('projects.flow.billingA')}<b>{t('projects.flow.billingB')}</b>{t('projects.flow.billingC')}{flow?.invoice && <span className={ui.mono}> {t('projects.flow.invoiceTime', { number: flow.invoice.number, ms: flow.invoiceMs ?? '' })}</span>}{flow?.timedOut && !flow.invoice && <span className={ui.mono}> {t('projects.flow.waiting')}</span>}</li>
        </ol>
      </section>
    </div>
  );
}
