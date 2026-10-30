import { InvalidEventError } from './errors';
import { Fact } from './fact';
import { AllocationFact, buildProfitability, parseAllocationRemoved, parseEngineerAllocated, workingDays } from './profitability';

describe('workingDays (Monday to Friday, both ends included)', () => {
  // 2026-11-02 es lunes.
  it.each<[string, string, number]>([
    ['2026-11-02', '2026-11-02', 1], ['2026-11-02', '2026-11-06', 5], ['2026-11-02', '2026-11-08', 5], ['2026-11-07', '2026-11-08', 0], ['2026-11-06', '2026-11-09', 2],
    ['2026-11-02', '2026-11-15', 10], ['2026-11-02', '2026-12-31', 44], ['2026-11-03', '2026-11-02', 0], ['2024-02-28', '2024-03-01', 3], ['2026-11-08', '2026-11-09', 1],
  ])('%s to %s = %i', (a, b, n) => { expect(workingDays(a, b)).toBe(n); });
  it('matches a brute-force count over 400 different ranges', () => {
    for (let i = 0; i < 400; i++) {
      const a = Date.UTC(2026, 0, 1) + (i * 7 % 300) * 86_400_000, len = (i * 13) % 120; const b = a + len * 86_400_000;
      let n = 0; for (let t = a; t <= b; t += 86_400_000) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
      expect(workingDays(new Date(a).toISOString().slice(0, 10), new Date(b).toISOString().slice(0, 10))).toBe(n);
    }
  });
});

const ev = (data: object = {}, over: object = {}) => ({ eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01', type: 'EngineerAllocated', occurredAt: '2026-10-30T10:00:00.000Z', correlationId: 'corr-12345678',
  data: { allocationId: '5a1c0e2f-1111-4b2c-8d3e-9f0a1b2c3d4e', engineerName: 'Ana Torres', projectName: 'Branch network upgrade', percent: 50, periodStart: '2026-11-02', periodEnd: '2026-11-13', dailyCostCop: 400_000, ...data }, ...over });

describe('parsing the capacity events', () => {
  it('accepts an allocation with cost, without cost (old events) and with null', () => {
    expect(parseEngineerAllocated(ev()).dailyCostCop).toBe(400_000);
    expect(parseEngineerAllocated(ev({ dailyCostCop: undefined })).dailyCostCop).toBeNull();
    expect(parseEngineerAllocated(ev({ dailyCostCop: null })).dailyCostCop).toBeNull();
  });
  it.each<[string, unknown]>([['null', null], ['other type', ev({}, { type: 'X' })], ['bad id', ev({ allocationId: 'x' })], ['percent 0', ev({ percent: 0 })], ['percent 101', ev({ percent: 101 })], ['name <', ev({ engineerName: '<i>' })],
    ['impossible date', ev({ periodStart: '2026-02-30' })], ['end < start', ev({ periodEnd: '2026-10-01' })], ['cost 0', ev({ dailyCostCop: 0 })], ['cost text', ev({ dailyCostCop: '5' })], ['cost decimal', ev({ dailyCostCop: 1.5 })], ['cost huge', ev({ dailyCostCop: 50_000_001 })],
  ])('refuses %s', (_n, raw) => { expect(() => parseEngineerAllocated(raw)).toThrow(InvalidEventError); });
  it('removal keeps only the id and refuses the rest', () => {
    expect(parseAllocationRemoved(ev({}, { type: 'AllocationRemoved' }))).toEqual({ allocationId: '5a1c0e2f-1111-4b2c-8d3e-9f0a1b2c3d4e' });
    expect(() => parseAllocationRemoved(ev({ allocationId: 'x' }, { type: 'AllocationRemoved' }))).toThrow(InvalidEventError);
    expect(() => parseAllocationRemoved(ev())).toThrow(InvalidEventError);
  });
});

const fact = (o: Partial<Fact>): Fact => ({ milestoneId: 'x', projectId: 'p', projectName: 'A', milestoneName: 'M', amountCop: 1_000_000, createdAt: null, overdueAt: null, overdueDays: null, approvedBy: null, approvedAt: null, invoiceNumber: null, invoiceStatus: null, taxCop: null, totalCop: null, draftedAt: null, issuedAt: null, paidCop: 0, ...o });
const al = (o: Partial<AllocationFact>): AllocationFact => ({ allocationId: 'a', projectName: 'A', engineerName: 'Ana', percent: 50, periodStart: '2026-11-02', periodEnd: '2026-11-13', dailyCostCop: 400_000, occurredAt: new Date(), ...o });
const NOW = new Date('2026-11-30T12:00:00Z');

describe('buildProfitability', () => {
  it('revenue = issued invoices without VAT (drafts and pending do not count); cost = percent x working days x daily cost', () => {
    const p = buildProfitability([fact({ invoiceStatus: 'issued', amountCop: 10_000_000 }), fact({ milestoneId: 'y', invoiceStatus: 'draft', amountCop: 5_000_000 }), fact({ milestoneId: 'z', amountCop: 7_000_000 })], [al({})], NOW);
    expect(p.projects).toEqual([{ projectName: 'A', revenueCop: 10_000_000, laborCostCop: 2_000_000, marginCop: 8_000_000, marginPct: 80, allocations: 1, uncostedAllocations: 0 }]);
    expect(p.totals).toEqual({ revenueCop: 10_000_000, laborCostCop: 2_000_000, marginCop: 8_000_000, uncostedAllocations: 0 }); // 50% x 10 días hábiles x 400.000
  });
  it('only the days already elapsed cost: an allocation that has not started costs nothing; a running one costs up to today', () => {
    const p = buildProfitability([], [al({ allocationId: 'f', periodStart: '2026-12-01', periodEnd: '2026-12-31' }), al({ allocationId: 'r', percent: 100, dailyCostCop: 100_000, periodStart: '2026-11-23', periodEnd: '2026-12-20' })], NOW);
    expect(p.projects[0].laborCostCop).toBe(6 * 100_000); // 23 al 30 de noviembre = 6 hábiles
  });
  it('an allocation without cost is counted as uncosted, adds 0 and is flagged; no revenue means no percentage', () => {
    const p = buildProfitability([], [al({ dailyCostCop: null }), al({ allocationId: 'b' })], NOW);
    expect(p.projects[0]).toMatchObject({ revenueCop: 0, laborCostCop: 2_000_000, marginCop: -2_000_000, marginPct: null, allocations: 2, uncostedAllocations: 1 });
    expect(p.totals.uncostedAllocations).toBe(1);
  });
  it('projects that appear only in allocations or only in invoices both show; the biggest revenue first; cost rounds to whole pesos', () => {
    const p = buildProfitability([fact({ projectName: 'B', invoiceStatus: 'issued', amountCop: 9 })], [al({ projectName: 'C', percent: 33, dailyCostCop: 1001, periodStart: '2026-11-02', periodEnd: '2026-11-02' })], NOW);
    expect(p.projects.map((x) => x.projectName)).toEqual(['B', 'C']); expect(p.projects[1].laborCostCop).toBe(330); // 0,33 x 1 x 1001 = 330,33
  });
  it('is empty-safe', () => { expect(buildProfitability([], [], NOW).projects).toEqual([]); });
});
