import { InvoiceNotDraftError } from './errors';

export type InvoiceStatus = 'draft' | 'issued';

export interface Invoice {
  number: string;
  milestoneId: string;
  projectName: string;
  milestoneName: string;
  amountCop: number;
  status: InvoiceStatus;
  createdAt: Date;
  issuedAt: Date | null;
  issuedBy: string | null;
  sourceEventId: string | null;
}

/** Regla: una factura solo se emite una vez (draft -> issued). No muta el original. */
export function issue(i: Invoice, by: string, now: Date): Invoice {
  if (i.status !== 'draft') throw new InvoiceNotDraftError(i.number);
  return { ...i, status: 'issued', issuedAt: now, issuedBy: by };
}
