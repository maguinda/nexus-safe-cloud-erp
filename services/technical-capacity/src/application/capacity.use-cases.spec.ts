import { Allocation } from '../domain/allocation';
import { dayNumber } from '../domain/dates';
import { Engineer } from '../domain/engineer';
import { AllocationNotFoundError, EngineerNotFoundError, OverAllocationError, ValidationError } from '../domain/errors';
import { CapacityEvent } from '../domain/events';
import { TransactionScope, UnitOfWork } from '../domain/ports';
import { AllocateEngineerUseCase, DeleteAllocationUseCase, ListCapacityUseCase } from './capacity.use-cases';

const ana: Engineer = { id: 'e1', name: 'Ana Torres', role: 'Network engineer', position: 'network_engineer', kind: 'engineer', skills: [], certifications: [], monthlySalaryCop: 9_900_000, dailyCostCop: 450_000 };
class FakeUow implements UnitOfWork {
  allocs: Allocation[] = []; outbox: CapacityEvent[] = []; failAfterInsert = false;
  async run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    const a0 = [...this.allocs], o0 = [...this.outbox];
    try {
      return await work({
        lockEngineer: async (id) => (id === 'e1' ? ana : null),
        allocationsOverlapping: async (id, from, to) => this.allocs.filter((x) => x.engineerId === id && x.start <= to && x.end >= from),
        insertAllocation: async (x) => { this.allocs.push(x); if (this.failAfterInsert) throw new Error('db down'); },
        deleteAllocation: async (id) => { const g = this.allocs.find((x) => x.id === id); this.allocs = this.allocs.filter((x) => x.id !== id); return g ? { projectName: g.projectName } : null; },
        addToOutbox: async (e) => { this.outbox.push(e); },
      });
    } catch (e) { this.allocs = a0; this.outbox = o0; throw e; }
  }
}
const input = (percent: number, s = '2026-11-02', e = '2026-11-30', extra: any = {}) => ({ projectName: 'Branch network upgrade', percent, startDate: s, endDate: e, ...extra });
const NOW = new Date('2026-11-01T10:00:00Z');

describe('AllocateEngineerUseCase', () => {
  it('accepts an allocation up to exactly 100% and publishes only EngineerAllocated', async () => {
    const uow = new FakeUow(); const uc = new AllocateEngineerUseCase(uow, () => NOW);
    await uc.execute('e1', input(60), 'trace-0001-abcd');
    const r = await uc.execute('e1', input(40), 'trace-0001-abcd');
    expect(r).toMatchObject({ overAllocated: false, peak: 100 });
    expect(uow.outbox.map((e) => e.type)).toEqual(['EngineerAllocated', 'EngineerAllocated']);
  });
  it('rejects going over 100% on any day, naming the peak, and leaves nothing behind', async () => {
    const uow = new FakeUow(); const uc = new AllocateEngineerUseCase(uow, () => NOW);
    await uc.execute('e1', input(70, '2026-11-02', '2026-11-10'), 'trace-0001-abcd');
    await expect(uc.execute('e1', input(40, '2026-11-10', '2026-11-20'), 'trace-0001-abcd')).rejects.toMatchObject({ peak: 110 });
    expect(uow.allocs).toHaveLength(1); expect(uow.outbox).toHaveLength(1);
  });
  it('periods that do not overlap never add up', async () => {
    const uow = new FakeUow(); const uc = new AllocateEngineerUseCase(uow, () => NOW);
    await uc.execute('e1', input(100, '2026-11-02', '2026-11-09'), 'trace-0001-abcd');
    await expect(uc.execute('e1', input(100, '2026-11-10', '2026-11-20'), 'trace-0001-abcd')).resolves.toBeTruthy();
  });
  it('with allowOverallocation it accepts, marks it and announces the PEAK with the period of the new allocation', async () => {
    const uow = new FakeUow(); const uc = new AllocateEngineerUseCase(uow, () => NOW);
    await uc.execute('e1', input(80), 'trace-0001-abcd');
    const r = await uc.execute('e1', input(50, '2026-11-05', '2026-11-12', { allowOverallocation: true }), 'trace-0002-abcd');
    expect(r).toMatchObject({ overAllocated: true, peak: 130 });
    const over = uow.outbox.find((e) => e.type === 'OverAllocationDetected')!;
    expect(over.data).toMatchObject({ engineerName: 'Ana Torres', allocationPercent: 130, periodStart: '2026-11-05', periodEnd: '2026-11-12' });
    expect(over.correlationId).toBe('trace-0002-abcd');
  });
  it('allowOverallocation on an allocation that does NOT go over announces nothing extra', async () => {
    const uow = new FakeUow(); const uc = new AllocateEngineerUseCase(uow, () => NOW);
    await uc.execute('e1', input(50, '2026-11-02', '2026-11-30', { allowOverallocation: true }), 'trace-0001-abcd');
    expect(uow.outbox.map((e) => e.type)).toEqual(['EngineerAllocated']);
  });
  it('the events carry no personal data beyond the business name of the engineer', async () => {
    const uow = new FakeUow(); await new AllocateEngineerUseCase(uow, () => NOW).execute('e1', input(50), 'trace-0001-abcd');
    expect(Object.keys(uow.outbox[0].data).sort()).toEqual(['allocationId', 'dailyCostCop', 'engineerName', 'percent', 'periodEnd', 'periodStart', 'projectName']);
  });
  it('unknown engineer → not found; invalid input is refused before touching the database', async () => {
    const uow = new FakeUow(); const uc = new AllocateEngineerUseCase(uow, () => NOW);
    await expect(uc.execute('nope', input(50), 'trace-0001-abcd')).rejects.toBeInstanceOf(EngineerNotFoundError);
    await expect(uc.execute('e1', input(0), 'trace-0001-abcd')).rejects.toBeInstanceOf(ValidationError);
    expect(uow.allocs).toHaveLength(0);
  });
  it('if the transaction fails after inserting, nothing stays (allocation and events go together)', async () => {
    const uow = new FakeUow(); uow.failAfterInsert = true;
    await expect(new AllocateEngineerUseCase(uow, () => NOW).execute('e1', input(50), 'trace-0001-abcd')).rejects.toThrow('db down');
    expect(uow.allocs).toHaveLength(0); expect(uow.outbox).toHaveLength(0);
  });
  it('OverAllocationError is a conflict carrying the peak', () => { expect(new OverAllocationError(120, 'Ana').message).toContain('120%'); });
});

describe('DeleteAllocationUseCase', () => {
  it('deletes, and an unknown id is not found', async () => {
    const uow = new FakeUow(); const r = await new AllocateEngineerUseCase(uow, () => NOW).execute('e1', input(50), 'trace-0001-abcd');
    await new DeleteAllocationUseCase(uow, () => NOW).execute(r.id, 'trace-0001-abcd');
    expect(uow.allocs).toHaveLength(0);
    expect(uow.outbox.map((e) => e.type)).toEqual(['EngineerAllocated', 'AllocationRemoved']);
    expect(uow.outbox[1]).toMatchObject({ type: 'AllocationRemoved', data: { allocationId: r.id, projectName: 'Branch network upgrade' } });
    await expect(new DeleteAllocationUseCase(uow).execute(r.id)).rejects.toBeInstanceOf(AllocationNotFoundError);
    expect(uow.outbox).toHaveLength(2); // borrar algo que no existe no anuncia nada
  });
  it('the allocation event carries the daily cost in force at that moment (null when there is none)', async () => {
    const uow = new FakeUow(); const uc = new AllocateEngineerUseCase(uow, () => NOW);
    await uc.execute('e1', input(50), 'trace-0001-abcd');
    expect((uow.outbox[0] as any).data.dailyCostCop).toBe(450_000);
  });
});

describe('ListCapacityUseCase', () => {
  it('computes the load from ALL current allocations even when only the first 100 are listed', async () => {
    const mk = (i: number): Allocation & { overAllocated: boolean } => ({ id: `a${i}`, engineerId: 'e1', projectName: 'P', percent: 1, start: dayNumber('2026-11-01', 'd') + i, end: dayNumber('2026-11-01', 'd') + i, overAllocated: false });
    const many = Array.from({ length: 120 }, (_, i) => mk(i));
    many.push({ ...mk(999), id: 'big', percent: 90, start: dayNumber('2026-11-20', 'd'), end: dayNumber('2026-11-20', 'd') }); // el día 19 desde hoy, después de la fila 100
    const out = await new ListCapacityUseCase({ engineersWithAllocations: async () => [{ engineer: ana, allocations: many }] }, () => NOW).execute();
    expect(out.engineers[0].allocations).toHaveLength(100);
    expect(out.engineers[0].peakNext30).toBe(91);
  });
  it('summarises each engineer from today and formats the dates', async () => {
    const x: Allocation & { overAllocated: boolean } = { id: 'a1', engineerId: 'e1', projectName: 'P', percent: 60, start: dayNumber('2026-10-20', 'd'), end: dayNumber('2026-11-20', 'd'), overAllocated: false };
    const out = await new ListCapacityUseCase({ engineersWithAllocations: async () => [{ engineer: ana, allocations: [x] }] }, () => NOW).execute();
    expect(out.today).toBe('2026-11-01');
    expect(out.engineers[0]).toMatchObject({ name: 'Ana Torres', loadToday: 60, freeToday: 40, peakNext30: 60, allocations: [{ id: 'a1', startDate: '2026-10-20', endDate: '2026-11-20' }] });
  });
});

describe('SetSalaryUseCase, the positions and the cost for the company', () => {
  const { SetSalaryUseCase } = require('./capacity.use-cases');
  const { monthlySalary, employerCost, employerDailyCost, newEngineer, position, POSITIONS, arlPpm, transportAid } = require('../domain/engineer');
  it('writes the salary (the store works out the cost with the SQL function), clears it, and refuses an unknown person', async () => {
    const calls: any[] = []; const cmds: any = { setSalary: async (id: string, s: number | null) => { calls.push([id, s]); return id === 'e1'; } };
    await new SetSalaryUseCase(cmds).execute('e1', 9_900_000); await new SetSalaryUseCase(cmds).execute('e1', null);
    expect(calls).toEqual([['e1', 9_900_000], ['e1', null]]);
    await expect(new SetSalaryUseCase(cmds).execute('zz', 5)).rejects.toBeInstanceOf(EngineerNotFoundError);
  });
  it.each([0, -1, 1.5, '300', NaN, 200_000_001, {}, []])('refuses the salary %p', (v) => { expect(() => monthlySalary(v)).toThrow(ValidationError); });
  it('accepts 1, the maximum, and empty means no salary', () => { expect(monthlySalary(1)).toBe(1); expect(monthlySalary(200_000_000)).toBe(200_000_000); expect(monthlySalary(undefined)).toBeNull(); expect(monthlySalary(null)).toBeNull(); });
  it('an engineer (no transport aid, ARL class I): benefits 21,83 %, pension 12 %, caja 4 %, ARL 0,522 %', () => {
    expect(employerCost(5_000_000, 'network_engineer')).toEqual({ salaryCop: 5_000_000, transportAidCop: 0, prestacionesCop: 1_091_500, pensionCop: 600_000, cajaCop: 200_000, arlCop: 26_100, monthlyCop: 6_917_600, dailyCop: 314_436 });
  });
  it('a field technician (transport aid 249.095 because he earns under 2 minimum wages; ARL class V 6,96 %)', () => {
    expect(employerCost(2_400_000, 'field_technician')).toMatchObject({ transportAidCop: 249_095, arlCop: 167_040, monthlyCop: 3_768_045, dailyCop: 171_275 });
    expect(employerCost(2_600_000, 'support_technician')).toMatchObject({ transportAidCop: 249_095, arlCop: 63_336, dailyCop: 179_091 }); // ARL clase III
  });
  it('the transport aid stops above 2 minimum wages (3.501.810) and the cost is always above the salary', () => {
    expect(transportAid(3_501_810)).toBe(249_095); expect(transportAid(3_501_811)).toBe(0);
    for (const [s, p] of [[1, 'tech_lead'], [1_000_000, 'field_technician'], [3_501_810, 'support_technician'], [200_000_000, 'tech_lead']] as const) { const c = employerCost(s, p); expect(c.monthlyCop).toBeGreaterThan(s); expect(c.dailyCop).toBeGreaterThanOrEqual(Math.floor(s / 22)); }
  });
  it('the ARL class follows the position', () => { expect(arlPpm('field_technician')).toBe(6_960); expect(arlPpm('support_technician')).toBe(2_436); for (const p of ['software_engineer', 'cloud_devops_engineer', 'security_engineer', 'network_engineer', 'tech_lead']) expect(arlPpm(p)).toBe(522); });
  it('no salary means no cost', () => { expect(employerDailyCost(null, 'tech_lead')).toBeNull(); expect(employerDailyCost(5_000_000, 'network_engineer')).toBe(314_436); });
  it('the position decides the kind; unknown positions and prototype keys are refused', () => {
    for (const [code, v] of Object.entries(POSITIONS) as [string, any][]) expect(newEngineer('Ana Torres', undefined, [], [], null, code)).toMatchObject({ position: code, kind: v.kind, role: v.label });
    expect(Object.values(POSITIONS).filter((v: any) => v.kind === 'technician')).toHaveLength(2);
    for (const bad of [undefined, null, '', 'engineer', 'toString', '__proto__', 'constructor', 5, {}]) expect(() => position(bad)).toThrow(ValidationError);
    expect(newEngineer('Ana Torres', 'Jefa de redes', [], [], 9_900_000, 'network_engineer')).toMatchObject({ role: 'Jefa de redes', monthlySalaryCop: 9_900_000, dailyCostCop: 622_584 });
  });
});
