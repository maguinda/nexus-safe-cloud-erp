import { InvalidEventError } from './errors';
import { AnalyticsEvent, parseEvent } from './events';
import { describe as describeEvent, Fact, mergeEvent } from './fact';
import { ActivityItem, buildDashboard } from './dashboard';

const T0 = '2026-10-18T10:00:00.000Z', T1 = '2026-10-18T10:00:01.000Z', T2 = '2026-10-18T10:05:00.000Z';
const base = (n: number, at = T0) => ({ eventId: `0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a${String(n).padStart(2, '0')}`, occurredAt: at, correlationId: 'corr-12345678' });
const inv = { invoiceNumber: 'INV-0103', milestoneId: 'm2', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', amountCop: 18_500_000, taxCop: 3_515_000, totalCop: 22_015_000 };
const T_1 = '2026-10-18T09:59:00.000Z'; // antes de la aprobación
const created = (over: any = {}) => ({ ...base(4, T_1), type: 'MilestoneCreated', data: { milestoneId: 'm2', milestoneName: 'Link redundancy design', projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 18_500_000, ...over } });
const approved = (over: any = {}) => ({ ...base(1, T0), type: 'MilestoneApproved', data: { milestoneId: 'm2', milestoneName: 'Link redundancy design', projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 18_500_000, approvedBy: 'laura.rios@nexus.example', ...over } });
const drafted = (over: any = {}) => ({ ...base(2, T1), type: 'InvoiceDrafted', data: { ...inv, approvedBy: 'laura.rios@nexus.example', ...over } });
const T3 = '2026-11-20T00:00:00.000Z';
const overdue = (over: any = {}) => ({ ...base(5, T3), type: 'InvoiceOverdue', data: { ...inv, dueDate: '2026-11-17T15:00:00.000Z', daysOverdue: 3, ...over } });
const issued = (over: any = {}) => ({ ...base(3, T2), type: 'InvoiceIssued', data: { ...inv, issuedBy: 'andres.mora@nexus.example', ...over } });

describe('parseEvent', () => {
  it('accepts the five event types and ignores unknown extra fields', () => {
    expect(parseEvent(overdue()).type).toBe('InvoiceOverdue');
    expect(parseEvent(created()).type).toBe('MilestoneCreated');
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
    ['empty project name', approved({ projectName: ' ' })],
    ['overdue: no days', overdue({ daysOverdue: undefined })], ['overdue: zero days', overdue({ daysOverdue: 0 })], ['overdue: negative days', overdue({ daysOverdue: -2 })], ['overdue: fractional days', overdue({ daysOverdue: 1.5 })], ['overdue: absurd days', overdue({ daysOverdue: 99_999 })], ['overdue: days as text', overdue({ daysOverdue: '3' })], ['overdue: no due date', overdue({ dueDate: undefined })], ['overdue: due date not a date', overdue({ dueDate: 'soon' })], ['overdue: bad invoice number', overdue({ invoiceNumber: "INV-1'; --" })], ['overdue: total does not add up', overdue({ totalCop: 5 })],
    ['created: amount 0', created({ amountCop: 0 })], ['created: milestoneId with a slash', created({ milestoneId: '../m2' })], ['created: no project id', created({ projectId: undefined })], ['created: project name too long', created({ projectName: 'a'.repeat(201) })], ['created: amount as text', created({ amountCop: '100' })], ['project name too long', approved({ projectName: 'a'.repeat(201) })],
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
      milestoneId: 'm2', projectId: 'p1', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', amountCop: 18_500_000, createdAt: null, overdueAt: null, overdueDays: null,
      approvedBy: 'laura.rios@nexus.example', approvedAt: new Date(T0), invoiceNumber: 'INV-0103', invoiceStatus: 'issued', taxCop: 3_515_000, totalCop: 22_015_000,
      draftedAt: new Date(T1), issuedAt: new Date(T2),
    });
  });
  it('MilestoneCreated alone makes a pending fact (created, not approved, no invoice)', () => {
    const f = fold([parseEvent(created())]);
    expect(f).toMatchObject({ milestoneId: 'm2', projectId: 'p1', createdAt: new Date(T_1), approvedAt: null, approvedBy: null, invoiceNumber: null, invoiceStatus: null });
  });
  it('with the creation event the fact gives the SAME result in every arrival order (all 24 permutations) and keeps the creation date', () => {
    const all = [created(), approved(), drafted(), issued()].map((e) => parseEvent(e));
    const expected = fold(all);
    expect(expected.createdAt).toEqual(new Date(T_1));
    for (const p of perms(all)) expect(fold(p)).toEqual(expected);
  });
  it('InvoiceOverdue records when it was known and how many days it was late, and does not change the invoice status', () => {
    const f = fold([parseEvent(approved()), parseEvent(drafted()), parseEvent(issued()), parseEvent(overdue())]);
    expect(f).toMatchObject({ invoiceStatus: 'issued', overdueAt: new Date(T3), overdueDays: 3 });
    const alone = fold([parseEvent(overdue())]);
    expect(alone).toMatchObject({ invoiceNumber: 'INV-0103', overdueAt: new Date(T3), overdueDays: 3, invoiceStatus: null, approvedAt: null });
  });
  it('with ALL FIVE events the fact is the same in every one of the 120 arrival orders', () => {
    const all = [created(), approved(), drafted(), issued(), overdue()].map((e) => parseEvent(e));
    const expected = fold(all);
    expect(expected).toMatchObject({ createdAt: new Date(T_1), overdueAt: new Date(T3), overdueDays: 3, invoiceStatus: 'issued' });
    for (const p of perms(all)) expect(fold(p)).toEqual(expected);
  });
  it('a repeated InvoiceOverdue (later, with more days) keeps the FIRST date and days: it is told once', () => {
    const later = parseEvent(overdue({ daysOverdue: 9 })); const first = parseEvent(overdue());
    const f = fold([first, { ...later, occurredAt: '2026-11-26T00:00:00.000Z' } as AnalyticsEvent]);
    expect(f).toMatchObject({ overdueAt: new Date(T3), overdueDays: 3 });
  });
  it('a late creation event does not make an approved milestone pending again', () => {
    const f = fold([parseEvent(approved()), parseEvent(created())]);
    expect(f.approvedAt).toEqual(new Date(T0)); expect(f.createdAt).toEqual(new Date(T_1));
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
  it('says an invoice is overdue, with the days (singular and plural)', () => {
    expect(describeEvent(parseEvent(overdue()))).toBe('Invoice INV-0103 is overdue by 3 days · total 22.015.000 COP');
    expect(describeEvent(parseEvent(overdue({ daysOverdue: 1 })))).toBe('Invoice INV-0103 is overdue by 1 day · total 22.015.000 COP');
  });
  it('says what a new milestone is: created and waiting for approval', () => {
    expect(describeEvent(parseEvent(created()))).toBe('New milestone “Link redundancy design” (Branch network upgrade) · 18.500.000 COP pending approval');
  });
  it('writes a short readable line per event', () => {
    const [a, d, i] = [approved(), drafted(), issued()].map((e) => parseEvent(e));
    expect(describeEvent(a)).toBe('laura.rios@nexus.example approved “Link redundancy design” (Branch network upgrade) · 18.500.000 COP');
    expect(describeEvent(d)).toBe('Draft invoice INV-0103 created for “Link redundancy design” · total 22.015.000 COP');
    expect(describeEvent(i)).toBe('andres.mora@nexus.example issued invoice INV-0103 · total 22.015.000 COP');
  });
});

describe('buildDashboard', () => {
  const fact = (o: Partial<Fact>): Fact => ({ milestoneId: 'x', projectId: 'p', projectName: 'A', milestoneName: 'M', amountCop: 1000, createdAt: null, overdueAt: null, overdueDays: null, approvedBy: 'a@x.co', approvedAt: new Date(T0), invoiceNumber: null, invoiceStatus: null, taxCop: null, totalCop: null, draftedAt: null, issuedAt: null, ...o });
  const act = (n: number, lagMs: number): ActivityItem => ({ kind: 'MilestoneApproved', message: `m${n}`, occurredAt: new Date(T0), receivedAt: new Date(Date.parse(T0) + lagMs) });
  const NOW = new Date('2026-10-18T10:10:00Z');

  it('is empty-safe', () => {
    const d = buildDashboard([], [], 0, NOW);
    expect(d.totals).toEqual({ milestonesPending: { count: 0, cop: 0 }, overdue: { count: 0, totalCop: 0 }, milestonesApproved: 0, approvedCop: 0, waitingForInvoice: { count: 0, cop: 0 }, draft: { count: 0, totalCop: 0 }, issued: { count: 0, subtotalCop: 0, taxCop: 0, totalCop: 0 } });
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
    expect(d.totals).toEqual({ milestonesPending: { count: 0, cop: 0 }, overdue: { count: 0, totalCop: 0 }, milestonesApproved: 4, approvedCop: 7500, waitingForInvoice: { count: 1, cop: 1000 }, draft: { count: 1, totalCop: 2380 }, issued: { count: 2, subtotalCop: 4500, taxCop: 855, totalCop: 5355 } });
    expect(d.projects).toEqual([
      { projectName: 'A', milestonesPending: 0, milestonesApproved: 3, approvedCop: 7000, waitingForInvoice: 1, draftTotalCop: 2380, issuedTotalCop: 4760, overdueInvoices: 0 },
      { projectName: 'B', milestonesPending: 0, milestonesApproved: 1, approvedCop: 500, waitingForInvoice: 0, draftTotalCop: 0, issuedTotalCop: 595, overdueInvoices: 0 },
    ]);
    expect(d.freshness).toEqual({ lastEventAt: T0, lastEventLagMs: 120, eventsProcessed: 9 });
    expect(d.asOf).toBe(NOW.toISOString());
  });
  it('counts the milestones that were created and are still waiting for approval, per project and in total', () => {
    const facts = [
      fact({ milestoneId: 'p1', projectName: 'A', amountCop: 3000, createdAt: new Date(T0), approvedAt: null, approvedBy: null }),   // pendiente
      fact({ milestoneId: 'p2', projectName: 'A', amountCop: 500, createdAt: new Date(T0), approvedAt: null, approvedBy: null }),    // pendiente
      fact({ milestoneId: 'p3', projectName: 'B', amountCop: 700, createdAt: new Date(T0), approvedAt: new Date(T1) }),             // ya aprobado: no cuenta
      fact({ milestoneId: 'p4', projectName: 'B', amountCop: 900, createdAt: null, approvedAt: null, approvedBy: null }),            // anterior al evento: no cuenta
    ];
    const d = buildDashboard(facts, [], 1, NOW);
    expect(d.totals.milestonesPending).toEqual({ count: 2, cop: 3500 });
    expect(d.projects.map((r) => [r.projectName, r.milestonesPending])).toEqual([['B', 0], ['A', 2]]);
  });
  it('counts the overdue invoices and what they add up to (with IVA), in total and per project', () => {
    const facts = [
      fact({ milestoneId: 'o1', projectName: 'A', invoiceNumber: 'INV-1', invoiceStatus: 'issued', taxCop: 190, totalCop: 1190, overdueAt: new Date(T0), overdueDays: 2 }),
      fact({ milestoneId: 'o2', projectName: 'A', invoiceNumber: 'INV-2', invoiceStatus: 'issued', taxCop: 380, totalCop: 2380, overdueAt: new Date(T0), overdueDays: 9 }),
      fact({ milestoneId: 'o3', projectName: 'B', invoiceNumber: 'INV-3', invoiceStatus: 'issued', taxCop: 95, totalCop: 595 }), // emitida pero no vencida
      fact({ milestoneId: 'o4', projectName: 'B', invoiceNumber: 'INV-4', invoiceStatus: 'issued', taxCop: 95, totalCop: 595, overdueAt: new Date(T0), overdueDays: 1 }),
    ];
    const d = buildDashboard(facts, [], 1, NOW);
    expect(d.totals.overdue).toEqual({ count: 3, totalCop: 4165 });
    expect(Object.fromEntries(d.projects.map((r) => [r.projectName, r.overdueInvoices]))).toEqual({ A: 2, B: 1 });
  });
  it('an overdue notice that arrived before the invoice was issued still counts as overdue (arrival order does not matter)', () => {
    const d = buildDashboard([fact({ approvedAt: null, approvedBy: null, invoiceNumber: 'INV-1', invoiceStatus: null, totalCop: 1190, overdueAt: new Date(T0), overdueDays: 4 })], [], 1, NOW);
    expect(d.totals.overdue).toEqual({ count: 1, totalCop: 1190 });
  });
  it('a project with only pending milestones still appears', () => {
    const d = buildDashboard([fact({ projectName: 'Solo pendientes', createdAt: new Date(T0), approvedAt: null, approvedBy: null })], [], 1, NOW);
    expect(d.projects).toEqual([{ projectName: 'Solo pendientes', milestonesPending: 1, milestonesApproved: 0, approvedCop: 0, waitingForInvoice: 0, draftTotalCop: 0, issuedTotalCop: 0, overdueInvoices: 0 }]);
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
