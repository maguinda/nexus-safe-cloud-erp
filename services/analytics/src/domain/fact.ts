import { AnalyticsEvent } from './events';

export type InvoiceStatus = 'draft' | 'issued';

/** Modelo de lectura: una fila por hito, armada SOLO con eventos. Ningún servicio llama a Analytics ni Analytics a ellos. */
export interface Fact {
  milestoneId: string;
  projectId: string | null;
  projectName: string;
  milestoneName: string;
  /** Subtotal aprobado (antes de IVA). */
  amountCop: number;
  /** Cuándo se creó el hito (lo dice MilestoneCreated); null en los hitos anteriores a ese evento. Sin `approvedAt` = pendiente. */
  createdAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  invoiceNumber: string | null;
  invoiceStatus: InvoiceStatus | null;
  taxCop: number | null;
  totalCop: number | null;
  draftedAt: Date | null;
  issuedAt: Date | null;
  /** Cuándo se supo que la factura venció y cuántos días llevaba; null si no ha vencido. */
  overdueAt: Date | null;
  overdueDays: number | null;
}

/** Fila inicial con lo que trae cualquier evento (todos llevan nombres y monto); el resto se completa al fusionar. */
export function emptyFact(e: AnalyticsEvent): Fact {
  return {
    milestoneId: e.data.milestoneId, projectId: null, projectName: e.data.projectName, milestoneName: e.data.milestoneName, amountCop: e.data.amountCop,
    createdAt: null, approvedBy: null, approvedAt: null, invoiceNumber: null, invoiceStatus: null, taxCop: null, totalCop: null, draftedAt: null, issuedAt: null, overdueAt: null, overdueDays: null,
  };
}

/**
 * Fusiona un evento en el hecho. El resultado NO depende del orden de llegada: RabbitMQ no garantiza orden entre
 * publicadores distintos, así que «emitida» nunca vuelve a «borrador» y cada campo lo escribe un solo tipo de evento.
 */
export function mergeEvent(prev: Fact | null, e: AnalyticsEvent): Fact {
  const f: Fact = { ...(prev ?? emptyFact(e)) };
  const at = new Date(e.occurredAt);
  switch (e.type) {
    case 'MilestoneCreated':
      f.projectId = e.data.projectId; f.projectName = e.data.projectName; f.milestoneName = e.data.milestoneName; f.amountCop = e.data.amountCop;
      f.createdAt = f.createdAt ?? at;
      break;
    case 'MilestoneApproved':
      f.projectId = e.data.projectId; f.projectName = e.data.projectName; f.milestoneName = e.data.milestoneName; f.amountCop = e.data.amountCop;
      f.approvedBy = e.data.approvedBy; f.approvedAt = f.approvedAt ?? at;
      break;
    case 'InvoiceDrafted':
      f.invoiceNumber = e.data.invoiceNumber; f.taxCop = e.data.taxCop; f.totalCop = e.data.totalCop; f.draftedAt = f.draftedAt ?? at;
      if (f.invoiceStatus !== 'issued') f.invoiceStatus = 'draft';
      if (f.approvedBy === null) f.approvedBy = e.data.approvedBy;
      break;
    case 'InvoiceOverdue':
      // Vencida: no cambia el estado de la factura (sigue «emitida»), solo se anota cuándo se supo. Si llega antes que otros eventos, el resultado es el mismo.
      f.invoiceNumber = e.data.invoiceNumber; f.taxCop = e.data.taxCop; f.totalCop = e.data.totalCop;
      f.overdueAt = f.overdueAt ?? at; f.overdueDays = f.overdueDays ?? e.data.daysOverdue;
      break;
    case 'InvoiceIssued':
      f.invoiceNumber = e.data.invoiceNumber; f.taxCop = e.data.taxCop; f.totalCop = e.data.totalCop; f.invoiceStatus = 'issued'; f.issuedAt = f.issuedAt ?? at;
      break;
  }
  return f;
}

const cop = (n: number) => `${new Intl.NumberFormat('es-CO').format(n)} COP`;
/** Texto corto para la lista de actividad reciente. */
export function describe(e: AnalyticsEvent): string {
  switch (e.type) {
    case 'MilestoneCreated': return `New milestone “${e.data.milestoneName}” (${e.data.projectName}) · ${cop(e.data.amountCop)} pending approval`;
    case 'MilestoneApproved': return `${e.data.approvedBy} approved “${e.data.milestoneName}” (${e.data.projectName}) · ${cop(e.data.amountCop)}`;
    case 'InvoiceDrafted': return `Draft invoice ${e.data.invoiceNumber} created for “${e.data.milestoneName}” · total ${cop(e.data.totalCop)}`;
    case 'InvoiceOverdue': return `Invoice ${e.data.invoiceNumber} is overdue by ${e.data.daysOverdue} day${e.data.daysOverdue === 1 ? '' : 's'} · total ${cop(e.data.totalCop)}`;
    case 'InvoiceIssued': return `${e.data.issuedBy} issued invoice ${e.data.invoiceNumber} · total ${cop(e.data.totalCop)}`;
  }
}
