import { InvalidEventError } from './errors';
import { parseAudit, summarize } from './audit';

const ev = (data: object = {}, over: object = {}) => ({ eventId: '0B8F2C1E-5D4A-4E7B-9A63-1C2D3E4F5A01', type: 'InvoiceIssued', occurredAt: '2026-10-30T10:00:00.000Z', correlationId: 'corr-12345678', data: { invoiceNumber: 'INV-0103', totalCop: 22_015_000, issuedBy: 'Andres.Mora@nexus.example', secret: 'x', ...data }, ...over });

describe('parseAudit', () => {
  it('keeps the envelope, the actor (lowercase) and a short summary; never the full data', () => {
    const a = parseAudit(ev());
    expect(a).toEqual({ eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01', type: 'InvoiceIssued', occurredAt: new Date('2026-10-30T10:00:00.000Z'), actor: 'andres.mora@nexus.example', summary: 'Invoice INV-0103 issued (22.015.000 COP)', correlationId: 'corr-12345678' });
    expect(JSON.stringify(a)).not.toContain('secret');
  });
  it.each([['approvedBy'], ['registeredBy'], ['issuedBy'], ['createdBy'], ['changedBy']])('takes the actor from %s', (f) => { expect(parseAudit(ev({ issuedBy: undefined, [f]: 'a@b.co' })).actor).toBe('a@b.co'); });
  it('an event with no actor field has no actor; a strange value is not taken as one', () => {
    expect(parseAudit(ev({ issuedBy: undefined })).actor).toBeNull();
    expect(parseAudit(ev({ issuedBy: '<script>@x' })).actor).toBeNull();
    expect(parseAudit(ev({ issuedBy: 'sin arroba' })).actor).toBeNull();
  });
  it('an unknown type is still logged, by its name', () => { expect(parseAudit(ev({}, { type: 'BrandNewThing' })).summary).toBe('Event BrandNewThing'); });
  it('markup or control characters in a name never reach the summary', () => {
    expect(summarize('MilestoneApproved', { milestoneName: '<img onerror=x>', projectName: 'P', amountCop: 5 })).toContain('“?”');
    expect(summarize('MilestoneApproved', { milestoneName: 'a\u0000b', projectName: 'P', amountCop: 5 })).toContain('“?”');
  });
  it.each<[string, unknown]>([['null', null], ['an array', []], ['bad eventId', ev({}, { eventId: 'x' })], ['type with digits', ev({}, { type: 'Type1' })], ['type with <', ev({}, { type: '<b>' })], ['empty type', ev({}, { type: '' })],
    ['bad date', ev({}, { occurredAt: 'ayer' })], ['bad correlation', ev({}, { correlationId: 'bad id!' })], ['no data', ev({}, { data: undefined })], ['data a list', ev({}, { data: [] })],
  ])('refuses %s', (_n, raw) => { expect(() => parseAudit(raw)).toThrow(InvalidEventError); });
  it('summaries of every known type read well', () => {
    const t: [string, object, string][] = [
      ['MilestoneCreated', { milestoneName: 'M', projectName: 'P', amountCop: 1000 }, 'Milestone “M” created in P (1.000 COP)'],
      ['PaymentReceived', { paymentCop: 500, invoiceNumber: 'INV-0001', paidInFull: true }, 'Payment of 500 COP on invoice INV-0001 (paid in full)'],
      ['EngineerAllocated', { engineerName: 'Ana', projectName: 'P', percent: 50 }, 'Ana allocated to P at 50%'],
      ['AllocationRemoved', { projectName: 'P' }, 'Allocation removed from P'],
      ['EquipmentInstalled', { itemName: 'Router', installNumber: 'INS-0001' }, 'Equipment installed: Router (INS-0001)'],
      ['EquipmentPurchased', { itemName: 'Router', orderNumber: 'PO-0001' }, 'Equipment purchased: Router (order PO-0001)'],
    ];
    for (const [type, data, text] of t) expect(summarize(type, data as any)).toBe(text);
  });
  it('summarizes the identity events with the person’s name and roles, takes the actor, and never copies anything else', () => {
    const base = { eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a02', occurredAt: '2026-11-01T10:00:00.000Z', correlationId: 'corr-12345678' };
    const c = parseAudit({ ...base, type: 'UserCreated', data: { userId: 'u1', userName: 'Carlos Pérez', role: 'sales', staffId: null, createdBy: 'Diana.Vega@nexus.example', secret: 'x' } });
    expect(c).toMatchObject({ type: 'UserCreated', actor: 'diana.vega@nexus.example', summary: 'User “Carlos Pérez” created with role sales' });
    const r = parseAudit({ ...base, type: 'RoleChanged', data: { userId: 'u1', userName: 'Carlos Pérez', previousRole: 'sales', role: 'manager', changedBy: 'diana.vega@nexus.example' } });
    expect(r.summary).toBe('Role of “Carlos Pérez” changed from sales to manager');
    expect(JSON.stringify([c, r])).not.toContain('secret');
  });
});
