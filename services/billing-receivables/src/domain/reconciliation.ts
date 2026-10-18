import { Invoice } from './invoice';
import { computeTotals } from './tax';

export interface ReconciliationRow {
  milestoneId: string;
  invoiceNumber: string;
  status: Invoice['status'];
  subtotalCop: number;
  taxCop: number;
  totalCop: number;
  approvedBy: string | null;
  approvedAt: string | null;
  /** true si el IVA y el total guardados coinciden con recalcularlos desde el subtotal. */
  consistent: boolean;
}

export interface Reconciliation {
  rows: ReconciliationRow[];
  summary: { invoices: number; draft: number; issued: number; subtotalCop: number; taxCop: number; totalCop: number; inconsistent: number };
}

/** Conciliación hito -> factura: cada fila enlaza un hito aprobado con su factura y comprueba que los importes cuadren. */
export function reconcile(invoices: Invoice[]): Reconciliation {
  const rows = invoices.map<ReconciliationRow>((i) => {
    let consistent = false;
    try {
      const expected = computeTotals(i.amountCop);
      consistent = expected.taxCop === i.taxCop && expected.totalCop === i.totalCop;
    } catch { /* subtotal fuera de rango: queda inconsistente */ }
    return {
      milestoneId: i.milestoneId, invoiceNumber: i.number, status: i.status,
      subtotalCop: i.amountCop, taxCop: i.taxCop, totalCop: i.totalCop,
      approvedBy: i.approvedBy, approvedAt: i.approvedAt ? i.approvedAt.toISOString() : null, consistent,
    };
  });
  const sum = (k: 'subtotalCop' | 'taxCop' | 'totalCop') => rows.reduce((a, r) => a + r[k], 0);
  return {
    rows,
    summary: {
      invoices: rows.length, draft: rows.filter((r) => r.status === 'draft').length, issued: rows.filter((r) => r.status === 'issued').length,
      subtotalCop: sum('subtotalCop'), taxCop: sum('taxCop'), totalCop: sum('totalCop'), inconsistent: rows.filter((r) => !r.consistent).length,
    },
  };
}
