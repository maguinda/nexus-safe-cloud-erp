import { Fact } from './fact';

export interface ActivityItem { kind: string; message: string; occurredAt: Date; receivedAt: Date }

export interface ProjectRow {
  projectName: string;
  /** Hitos creados que todavía no se aprueban (solo los que nacieron con el evento MilestoneCreated). */
  milestonesPending: number;
  milestonesApproved: number;
  approvedCop: number;
  waitingForInvoice: number;
  draftTotalCop: number;
  issuedTotalCop: number;
  /** Facturas de este proyecto que ya pasaron su vencimiento (evento OverdueDetected de billing). */
  overdueInvoices: number;
}

export interface Dashboard {
  asOf: string;
  /** Qué tan al día está el modelo de lectura: cuándo ocurrió el último evento y cuánto tardó en llegar. */
  freshness: { lastEventAt: string | null; lastEventLagMs: number | null; eventsProcessed: number };
  totals: {
    milestonesPending: { count: number; cop: number };
    /** Facturas vencidas: cuántas y cuánto suman (con IVA). Una vez vencida, sigue vencida: este MVP no tiene pagos. */
    overdue: { count: number; totalCop: number };
    /** Lo cobrado: pesos recibidos en pagos y cuántas facturas ya están pagadas del todo. */
    collected: { totalCop: number; paidInvoices: number };
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
 * «Pendiente» = hito creado (MilestoneCreated) que todavía no se aprueba. Los hitos anteriores a ese evento no lo tienen y no se cuentan.
 */
export function buildDashboard(facts: Fact[], activity: ActivityItem[], eventsProcessed: number, now: Date): Dashboard {
  const rows = new Map<string, ProjectRow>();
  const row = (name: string): ProjectRow => {
    let r = rows.get(name);
    if (!r) { r = { projectName: name, milestonesPending: 0, milestonesApproved: 0, approvedCop: 0, waitingForInvoice: 0, draftTotalCop: 0, issuedTotalCop: 0, overdueInvoices: 0 }; rows.set(name, r); }
    return r;
  };
  const totals: Dashboard['totals'] = {
    milestonesPending: { count: 0, cop: 0 }, overdue: { count: 0, totalCop: 0 }, collected: { totalCop: 0, paidInvoices: 0 }, milestonesApproved: 0, approvedCop: 0, waitingForInvoice: { count: 0, cop: 0 }, draft: { count: 0, totalCop: 0 }, issued: { count: 0, subtotalCop: 0, taxCop: 0, totalCop: 0 },
  };
  for (const f of facts) {
    const r = row(f.projectName);
    if (f.createdAt && !f.approvedAt) { totals.milestonesPending.count++; totals.milestonesPending.cop += f.amountCop; r.milestonesPending++; }
    if (f.approvedAt) {
      totals.milestonesApproved++; totals.approvedCop += f.amountCop; r.milestonesApproved++; r.approvedCop += f.amountCop;
      if (!f.invoiceNumber) { totals.waitingForInvoice.count++; totals.waitingForInvoice.cop += f.amountCop; r.waitingForInvoice++; }
    }
    const paidInFull = f.totalCop !== null && f.totalCop > 0 && f.paidCop >= f.totalCop;
    totals.collected.totalCop += f.paidCop; if (paidInFull) totals.collected.paidInvoices++;
    // Vencida y SIN pagar del todo: una factura pagada ya no está por cobrar.
    if (f.overdueAt && !paidInFull) { totals.overdue.count++; totals.overdue.totalCop += f.totalCop ?? 0; r.overdueInvoices++; }
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
