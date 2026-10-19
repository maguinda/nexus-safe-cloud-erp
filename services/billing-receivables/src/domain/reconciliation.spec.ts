import { Invoice } from './invoice';
import { reconcile } from './reconciliation';

const inv = (n: number, sub: number, tax: number, total: number, status: Invoice['status'] = 'draft'): Invoice => ({
  number: `INV-${n}`, milestoneId: `m${n}`, projectName: 'P', milestoneName: 'M', amountCop: sub, taxCop: tax, totalCop: total, status,
  createdAt: new Date('2026-10-18T10:00:00Z'), issuedAt: null, issuedBy: null, sourceEventId: null,
  approvedBy: 'laura.rios@nexus.example', approvedAt: new Date('2026-10-18T09:00:00Z'), dueDate: null,
});

describe('reconcile', () => {
  it('links every invoice to its milestone and adds the totals up', () => {
    const r = reconcile([inv(1, 1_000, 190, 1_190), inv(2, 2_000, 380, 2_380, 'issued')]);
    expect(r.rows.map((x) => [x.milestoneId, x.invoiceNumber])).toEqual([['m1', 'INV-1'], ['m2', 'INV-2']]);
    expect(r.rows[0]).toMatchObject({ approvedBy: 'laura.rios@nexus.example', approvedAt: '2026-10-18T09:00:00.000Z', consistent: true });
    expect(r.summary).toEqual({ invoices: 2, draft: 1, issued: 1, subtotalCop: 3_000, taxCop: 570, totalCop: 3_570, inconsistent: 0 });
  });

  it('flags an invoice whose tax does not match 19 % of the subtotal', () => {
    const r = reconcile([inv(1, 1_000, 160, 1_160), inv(2, 1_000, 190, 1_190)]);
    expect(r.rows.map((x) => x.consistent)).toEqual([false, true]);
    expect(r.summary.inconsistent).toBe(1);
  });

  it('flags a wrong tax even when the total happens to be right', () => {
    expect(reconcile([inv(1, 1_000, 160, 1_190)]).rows[0].consistent).toBe(false);
  });

  it('flags a total that is not subtotal + tax and a subtotal out of range', () => {
    const r = reconcile([inv(1, 1_000, 190, 1_000), inv(2, 0, 0, 0)]);
    expect(r.rows.map((x) => x.consistent)).toEqual([false, false]);
  });

  it('is empty-safe', () => {
    expect(reconcile([]).summary).toEqual({ invoices: 0, draft: 0, issued: 0, subtotalCop: 0, taxCop: 0, totalCop: 0, inconsistent: 0 });
  });
});
