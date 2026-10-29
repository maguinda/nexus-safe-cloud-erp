import { InvoiceNotDraftError } from './errors';
import { Invoice, issue } from './invoice';

const draft: Invoice = {
  number: 'INV-0103', milestoneId: 'm2', projectName: 'P', milestoneName: 'M', amountCop: 1000, taxCop: 190, totalCop: 1190, status: 'draft',
  createdAt: new Date('2026-10-18T05:00:00Z'), issuedAt: null, issuedBy: null, sourceEventId: null, approvedBy: null, approvedAt: null, dueDate: null, clientName: null,
};

describe('issue', () => {
  it('turns a draft into an issued invoice due 30 days after the issue date', () => {
    const i = issue(draft, 'andres.mora@nexus.example', new Date('2026-12-15T09:30:00Z'));
    expect(i).toMatchObject({ status: 'issued', issuedBy: 'andres.mora@nexus.example', issuedAt: new Date('2026-12-15T09:30:00Z'), dueDate: new Date('2027-01-14T09:30:00Z') });
  });
  it('the due date is never before the issue date and is exactly 30 calendar days later', () => {
    for (const from of ['2026-01-31T00:00:00Z', '2028-02-10T12:00:00Z', '2026-12-31T23:59:59Z']) {
      const i = issue(draft, 'a@x.co', new Date(from));
      expect(i.dueDate!.getTime()).toBeGreaterThan(i.issuedAt!.getTime());
      expect(Math.round((i.dueDate!.getTime() - i.issuedAt!.getTime()) / 86_400_000)).toBe(30);
    }
  });
  it('does not change the draft it receives', () => {
    issue(draft, 'a@x.co', new Date('2026-10-18T06:00:00Z'));
    expect(draft.status).toBe('draft'); expect(draft.dueDate).toBeNull(); expect(draft.issuedAt).toBeNull();
  });
  it('refuses to issue an invoice that is not a draft', () => {
    const issued = issue(draft, 'a@x.co', new Date('2026-10-18T06:00:00Z'));
    expect(() => issue(issued, 'b@x.co', new Date())).toThrow(InvoiceNotDraftError);
    expect(issued.dueDate).toEqual(new Date('2026-11-17T06:00:00Z')); // el vencimiento original no se mueve
  });
});
