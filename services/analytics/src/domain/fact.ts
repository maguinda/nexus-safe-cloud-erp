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
  approvedBy: string | null;
  approvedAt: Date | null;
  invoiceNumber: string | null;
  invoiceStatus: InvoiceStatus | null;
  taxCop: number | null;
  totalCop: number | null;
  draftedAt: Date | null;
  issuedAt: Date | null;
}

/** Fila inicial con lo que trae cualquier evento (todos llevan nombres y monto); el resto se completa al fusionar. */
export function emptyFact(e: AnalyticsEvent): Fact {
  return {
    milestoneId: e.data.milestoneId, projectId: null, projectName: e.data.projectName, milestoneName: e.data.milestoneName, amountCop: e.data.amountCop,
    approvedBy: null, approvedAt: null, invoiceNumber: null, invoiceStatus: null, taxCop: null, totalCop: null, draftedAt: null, issuedAt: null,
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
    case 'MilestoneApproved':
      f.projectId = e.data.projectId; f.projectName = e.data.projectName; f.milestoneName = e.data.milestoneName; f.amountCop = e.data.amountCop;
      f.approvedBy = e.data.approvedBy; f.approvedAt = f.approvedAt ?? at;
      break;
    case 'InvoiceDrafted':
      f.invoiceNumber = e.data.invoiceNumber; f.taxCop = e.data.taxCop; f.totalCop = e.data.totalCop; f.draftedAt = f.draftedAt ?? at;
      if (f.invoiceStatus !== 'issued') f.invoiceStatus = 'draft';
      if (f.approvedBy === null) f.approvedBy = e.data.approvedBy;
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
    case 'MilestoneApproved': return `${e.data.approvedBy} approved “${e.data.milestoneName}” (${e.data.projectName}) · ${cop(e.data.amountCop)}`;
    case 'InvoiceDrafted': return `Draft invoice ${e.data.invoiceNumber} created for “${e.data.milestoneName}” · total ${cop(e.data.totalCop)}`;
    case 'InvoiceIssued': return `${e.data.issuedBy} issued invoice ${e.data.invoiceNumber} · total ${cop(e.data.totalCop)}`;
  }
}
