import { Fact } from './fact';

export interface ActivityItem { kind: string; message: string; occurredAt: Date; receivedAt: Date }

export interface ProjectRow {
  projectName: string;
  milestonesApproved: number;
  approvedCop: number;
  waitingForInvoice: number;
  draftTotalCop: number;
  issuedTotalCop: number;
}

export interface Dashboard {
  asOf: string;
  /** Qué tan al día está el modelo de lectura: cuándo ocurrió el último evento y cuánto tardó en llegar. */
  freshness: { lastEventAt: string | null; lastEventLagMs: number | null; eventsProcessed: number };
  totals: {
    milestonesApproved: number;
    approvedCop: number;
    waitingForInvoice: { count: number; cop: number };
    draft: { count: number; totalCop: number };
    issued: { count: number; subtotalCop: number; taxCop: number; totalCop: number };
  };
  projects: ProjectRow[];
  recentActivity: { at: string; kind: string; message: string }[];
}

/**
 * Función pura: de los hechos y la actividad al tablero. «Aprobado» es lo que dijo MilestoneApproved; las facturas
 * se cuentan por separado (un borrador puede llegar antes que la aprobación, y no por eso el hito deja de contar).
 * Límite conocido: los hitos PENDIENTES no aparecen porque projects no publica un evento al crearlos.
 */
export function buildDashboard(facts: Fact[], activity: ActivityItem[], eventsProcessed: number, now: Date): Dashboard {
  const rows = new Map<string, ProjectRow>();
  const row = (name: string): ProjectRow => {
    let r = rows.get(name);
    if (!r) { r = { projectName: name, milestonesApproved: 0, approvedCop: 0, waitingForInvoice: 0, draftTotalCop: 0, issuedTotalCop: 0 }; rows.set(name, r); }
    return r;
  };
  const totals: Dashboard['totals'] = {
    milestonesApproved: 0, approvedCop: 0, waitingForInvoice: { count: 0, cop: 0 }, draft: { count: 0, totalCop: 0 }, issued: { count: 0, subtotalCop: 0, taxCop: 0, totalCop: 0 },
  };
  for (const f of facts) {
    const r = row(f.projectName);
    if (f.approvedAt) {
      totals.milestonesApproved++; totals.approvedCop += f.amountCop; r.milestonesApproved++; r.approvedCop += f.amountCop;
      if (!f.invoiceNumber) { totals.waitingForInvoice.count++; totals.waitingForInvoice.cop += f.amountCop; r.waitingForInvoice++; }
    }
    if (f.invoiceStatus === 'draft') { totals.draft.count++; totals.draft.totalCop += f.totalCop ?? 0; r.draftTotalCop += f.totalCop ?? 0; }
    if (f.invoiceStatus === 'issued') {
      totals.issued.count++; totals.issued.subtotalCop += f.amountCop; totals.issued.taxCop += f.taxCop ?? 0; totals.issued.totalCop += f.totalCop ?? 0; r.issuedTotalCop += f.totalCop ?? 0;
    }
  }
  const projects = [...rows.values()].sort((a, b) => b.approvedCop - a.approvedCop || a.projectName.localeCompare(b.projectName));
  const last = activity[0];
  return {
    asOf: now.toISOString(),
    freshness: { lastEventAt: last ? last.occurredAt.toISOString() : null, lastEventLagMs: last ? Math.max(0, last.receivedAt.getTime() - last.occurredAt.getTime()) : null, eventsProcessed },
    totals,
    projects,
    recentActivity: activity.map((a) => ({ at: a.occurredAt.toISOString(), kind: a.kind, message: a.message })),
  };
}
