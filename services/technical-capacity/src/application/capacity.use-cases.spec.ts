import { Allocation } from '../domain/allocation';
import { dayNumber } from '../domain/dates';
import { Engineer } from '../domain/engineer';
import { AllocationNotFoundError, EngineerNotFoundError, OverAllocationError, ValidationError } from '../domain/errors';
import { CapacityEvent } from '../domain/events';
import { TransactionScope, UnitOfWork } from '../domain/ports';
import { AllocateEngineerUseCase, DeleteAllocationUseCase, ListCapacityUseCase } from './capacity.use-cases';

const ana: Engineer = { id: 'e1', name: 'Ana Torres', role: 'Network engineer', skills: [], certifications: [], dailyCostCop: 450_000 };
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

describe('SetDailyCostUseCase and the engineer cost rules', () => {
  const { SetDailyCostUseCase } = require('./capacity.use-cases');
  const { dailyCost } = require('../domain/engineer');
  it('writes, clears and refuses an unknown engineer', async () => {
    const calls: any[] = []; const cmds: any = { setDailyCost: async (id: string, c: number | null) => { calls.push([id, c]); return id === 'e1'; } };
    await new SetDailyCostUseCase(cmds).execute('e1', 500_000); await new SetDailyCostUseCase(cmds).execute('e1', null);
    expect(calls).toEqual([['e1', 500_000], ['e1', null]]);
    await expect(new SetDailyCostUseCase(cmds).execute('zz', 5)).rejects.toBeInstanceOf(EngineerNotFoundError);
  });
  it.each([0, -1, 1.5, '300', NaN, 50_000_001, {}, []])('refuses the cost %p', (v) => { expect(() => dailyCost(v)).toThrow(ValidationError); });
  it('accepts 1, the maximum, and empty means no cost', () => { expect(dailyCost(1)).toBe(1); expect(dailyCost(50_000_000)).toBe(50_000_000); expect(dailyCost(undefined)).toBeNull(); expect(dailyCost(null)).toBeNull(); });
});
