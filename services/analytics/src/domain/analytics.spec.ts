import { InvalidEventError } from './errors';
import { AnalyticsEvent, parseEvent } from './events';
import { describe as describeEvent, Fact, mergeEvent } from './fact';
import { ActivityItem, buildDashboard } from './dashboard';

const T0 = '2026-10-18T10:00:00.000Z', T1 = '2026-10-18T10:00:01.000Z', T2 = '2026-10-18T10:05:00.000Z';
const base = (n: number, at = T0) => ({ eventId: `0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a${String(n).padStart(2, '0')}`, occurredAt: at, correlationId: 'corr-12345678' });
const inv = { invoiceNumber: 'INV-0103', milestoneId: 'm2', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', amountCop: 18_500_000, taxCop: 3_515_000, totalCop: 22_015_000 };
const approved = (over: any = {}) => ({ ...base(1, T0), type: 'MilestoneApproved', data: { milestoneId: 'm2', milestoneName: 'Link redundancy design', projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 18_500_000, approvedBy: 'laura.rios@nexus.example', ...over } });
const drafted = (over: any = {}) => ({ ...base(2, T1), type: 'InvoiceDrafted', data: { ...inv, approvedBy: 'laura.rios@nexus.example', ...over } });
const issued = (over: any = {}) => ({ ...base(3, T2), type: 'InvoiceIssued', data: { ...inv, issuedBy: 'andres.mora@nexus.example', ...over } });

describe('parseEvent', () => {
  it('accepts the three event types and ignores unknown extra fields', () => {
    expect(parseEvent(approved()).type).toBe('MilestoneApproved');
    expect(parseEvent(drafted()).type).toBe('InvoiceDrafted');
    const e = parseEvent({ ...issued(), extra: 'x' }) as any;
    expect(e.type).toBe('InvoiceIssued'); expect(e).not.toHaveProperty('extra');
  });
  it('accepts a draft whose approver is null', () => { expect((parseEvent(drafted({ approvedBy: null })) as any).data.approvedBy).toBeNull(); });
  it.each<[string, unknown]>([
    ['null', null], ['an array', []], ['a string', 'x'], ['unknown type', { ...approved(), type: 'MilestoneRejected' }], ['no type', { ...approved(), type: undefined }],
    ['eventId not a UUID', { ...approved(), eventId: '1; DROP TABLE x' }], ['occurredAt not a date', { ...approved(), occurredAt: 'yesterday' }],
    ['correlationId with spaces', { ...approved(), correlationId: 'bad id!' }], ['data missing', { ...approved(), data: undefined }], ['data a list', { ...approved(), data: [] }],
    ['milestoneId with a slash', approved({ milestoneId: '../m2' })], ['amount 0', approved({ amountCop: 0 })], ['amount over the cap', approved({ amountCop: 1_000_000_001 })],
    ['amount as text', approved({ amountCop: '100' })], ['fractional amount', approved({ amountCop: 10.5 })], ['approver not an email', approved({ approvedBy: 'laura' })],
    ['empty project name', approved({ projectName: ' ' })], ['project name too long', approved({ projectName: 'a'.repeat(201) })],
    ['invoice number malformed', drafted({ invoiceNumber: 'INV-1' })], ['invoice number injection', drafted({ invoiceNumber: "INV-0103'; --" })],
    ['total does not add up', drafted({ totalCop: 22_015_001 })], ['negative tax', drafted({ taxCop: -1, totalCop: 18_499_999 })], ['issuer not an email', issued({ issuedBy: 'x' })], ['issuer missing', issued({ issuedBy: undefined })],
  ])('rejects %s', (_n, raw) => { expect(() => parseEvent(raw)).toThrow(InvalidEventError); });
});

const perms = <T,>(a: T[]): T[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));

describe('mergeEvent', () => {
  const evs = () => [approved(), drafted(), issued()].map((e) => parseEvent(e));
  const fold = (list: AnalyticsEvent[]) => list.reduce<Fact | null>((f, e) => mergeEvent(f, e), null)!;

  it('builds the fact from the three events', () => {
    expect(fold(evs())).toEqual({
      milestoneId: 'm2', projectId: 'p1', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', amountCop: 18_500_000,
      approvedBy: 'laura.rios@nexus.example', approvedAt: new Date(T0), invoiceNumber: 'INV-0103', invoiceStatus: 'issued', taxCop: 3_515_000, totalCop: 22_015_000,
      draftedAt: new Date(T1), issuedAt: new Date(T2),
    });
  });
  it('gives the SAME result in every arrival order (all 6 permutations)', () => {
    const expected = fold(evs());
    for (const p of perms(evs())) expect(fold(p)).toEqual(expected);
  });
  it('an issued invoice never goes back to draft, even if the draft event arrives late', () => {
    const [a, d, i] = evs();
    expect(fold([i, d, a]).invoiceStatus).toBe('issued');
    expect(fold([i, d]).invoiceStatus).toBe('issued');
  });
  it('is idempotent: applying any event twice changes nothing', () => {
    const [a, d, i] = evs(); const once = fold([a, d, i]);
    expect(fold([a, a, d, d, i, i])).toEqual(once);
  });
  it('a draft alone does not count as an approval', () => {
    const f = fold([evs()[1]]);
    expect(f.approvedAt).toBeNull(); expect(f.invoiceStatus).toBe('draft');
  });
  it('does not mutate the previous fact', () => {
    const f1 = mergeEvent(null, evs()[0]); const snapshot = JSON.stringify(f1);
    mergeEvent(f1, evs()[1]);
    expect(JSON.stringify(f1)).toBe(snapshot);
  });
});

describe('describe', () => {
  it('writes a short readable line per event', () => {
    const [a, d, i] = [approved(), drafted(), issued()].map((e) => parseEvent(e));
    expect(describeEvent(a)).toBe('laura.rios@nexus.example approved “Link redundancy design” (Branch network upgrade) · 18.500.000 COP');
    expect(describeEvent(d)).toBe('Draft invoice INV-0103 created for “Link redundancy design” · total 22.015.000 COP');
    expect(describeEvent(i)).toBe('andres.mora@nexus.example issued invoice INV-0103 · total 22.015.000 COP');
  });
});

describe('buildDashboard', () => {
  const fact = (o: Partial<Fact>): Fact => ({ milestoneId: 'x', projectId: 'p', projectName: 'A', milestoneName: 'M', amountCop: 1000, approvedBy: 'a@x.co', approvedAt: new Date(T0), invoiceNumber: null, invoiceStatus: null, taxCop: null, totalCop: null, draftedAt: null, issuedAt: null, ...o });
  const act = (n: number, lagMs: number): ActivityItem => ({ kind: 'MilestoneApproved', message: `m${n}`, occurredAt: new Date(T0), receivedAt: new Date(Date.parse(T0) + lagMs) });
  const NOW = new Date('2026-10-18T10:10:00Z');

  it('is empty-safe', () => {
    const d = buildDashboard([], [], 0, NOW);
    expect(d.totals).toEqual({ milestonesApproved: 0, approvedCop: 0, waitingForInvoice: { count: 0, cop: 0 }, draft: { count: 0, totalCop: 0 }, issued: { count: 0, subtotalCop: 0, taxCop: 0, totalCop: 0 } });
    expect(d.projects).toEqual([]); expect(d.freshness).toEqual({ lastEventAt: null, lastEventLagMs: null, eventsProcessed: 0 });
  });
  it('adds up approved, waiting, draft and issued amounts', () => {
    const facts = [
      fact({ milestoneId: 'a', amountCop: 1000 }),                                                                                      // aprobado, sin factura
      fact({ milestoneId: 'b', amountCop: 2000, invoiceNumber: 'INV-1', invoiceStatus: 'draft', taxCop: 380, totalCop: 2380 }),           // borrador
      fact({ milestoneId: 'c', amountCop: 4000, invoiceNumber: 'INV-2', invoiceStatus: 'issued', taxCop: 760, totalCop: 4760 }),          // emitida
      fact({ milestoneId: 'd', projectName: 'B', amountCop: 500, invoiceNumber: 'INV-3', invoiceStatus: 'issued', taxCop: 95, totalCop: 595 }),
    ];
    const d = buildDashboard(facts, [act(1, 120)], 9, NOW);
    expect(d.totals).toEqual({ milestonesApproved: 4, approvedCop: 7500, waitingForInvoice: { count: 1, cop: 1000 }, draft: { count: 1, totalCop: 2380 }, issued: { count: 2, subtotalCop: 4500, taxCop: 855, totalCop: 5355 } });
    expect(d.projects).toEqual([
      { projectName: 'A', milestonesApproved: 3, approvedCop: 7000, waitingForInvoice: 1, draftTotalCop: 2380, issuedTotalCop: 4760 },
      { projectName: 'B', milestonesApproved: 1, approvedCop: 500, waitingForInvoice: 0, draftTotalCop: 0, issuedTotalCop: 595 },
    ]);
    expect(d.freshness).toEqual({ lastEventAt: T0, lastEventLagMs: 120, eventsProcessed: 9 });
    expect(d.asOf).toBe(NOW.toISOString());
  });
  it('an invoice that arrived before its approval still counts as invoiced, not as an approved milestone', () => {
    const d = buildDashboard([fact({ approvedAt: null, approvedBy: null, invoiceNumber: 'INV-1', invoiceStatus: 'draft', taxCop: 190, totalCop: 1190 })], [], 1, NOW);
    expect(d.totals.milestonesApproved).toBe(0); expect(d.totals.draft).toEqual({ count: 1, totalCop: 1190 }); expect(d.totals.waitingForInvoice.count).toBe(0);
  });
  it('sorts projects by approved amount, then by name, and never shows a negative lag', () => {
    const d = buildDashboard([fact({ milestoneId: 'a', projectName: 'Z', amountCop: 10 }), fact({ milestoneId: 'b', projectName: 'A', amountCop: 10 }), fact({ milestoneId: 'c', projectName: 'M', amountCop: 99 })], [act(1, -50)], 3, NOW);
    expect(d.projects.map((p) => p.projectName)).toEqual(['M', 'A', 'Z']);
    expect(d.freshness.lastEventLagMs).toBe(0);
  });
});
