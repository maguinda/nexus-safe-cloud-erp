import { dueDate } from './due-date';
import { InvoiceNotDraftError } from './errors';

export type InvoiceStatus = 'draft' | 'issued';

export interface Invoice {
  number: string;
  milestoneId: string;
  projectName: string;
  /** El id del proyecto (viene en MilestoneApproved); ausente o null en las facturas anteriores. */
  projectId?: string | null;
  milestoneName: string;
  /** Subtotal (monto del hito, antes de IVA). */
  amountCop: number;
  taxCop: number;
  totalCop: number;
  status: InvoiceStatus;
  createdAt: Date;
  issuedAt: Date | null;
  issuedBy: string | null;
  sourceEventId: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  /** Solo las emitidas: fecha de emisión + 30 días (domain/due-date.ts). */
  dueDate: Date | null;
  /** El cliente del proyecto (viene en MilestoneApproved); null en las facturas anteriores a ese campo. */
  clientName: string | null;
}

/** Regla: una factura solo se emite una vez (draft -> issued) y al emitirse queda con su fecha de vencimiento. No muta el original. */
export function issue(i: Invoice, by: string, now: Date): Invoice {
  if (i.status !== 'draft') throw new InvoiceNotDraftError(i.number);
  return { ...i, status: 'issued', issuedAt: now, issuedBy: by, dueDate: dueDate(now) };
}
