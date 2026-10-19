import { InvalidEventError } from '../domain/errors';
import { Fact } from '../domain/fact';
import { EventScope, EventUnitOfWork } from '../domain/ports';
import { HandleEventUseCase } from './handle-event.use-case';

const approved = (id = '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01') => ({ eventId: id, type: 'MilestoneApproved', occurredAt: '2026-10-18T10:00:00.000Z', correlationId: 'corr-12345678',
  data: { milestoneId: 'm2', milestoneName: 'Design', projectId: 'p1', projectName: 'Branch', amountCop: 5_000_000, approvedBy: 'laura.rios@nexus.example' } });

/** Base en memoria con transacción simulada: si el trabajo falla, se deshace todo. */
function fakeDb(failOn?: 'merge' | 'activity') {
  let processed = new Set<string>(); let facts = new Map<string, Fact>(); let activity: string[] = [];
  const uow: EventUnitOfWork = {
    async run(work) {
      const sp = new Set(processed), sf = new Map(facts), sa = [...activity];
      const tx: EventScope = {
        markEventProcessed: async (id) => { if (processed.has(id)) return false; processed.add(id); return true; },
        mergeFact: async (e, merge) => { if (failOn === 'merge') throw new Error('db down'); const f = merge(facts.get(e.data.milestoneId) ?? null); facts.set(f.milestoneId, f); },
        addActivity: async (_id, _k, m) => { if (failOn === 'activity') throw new Error('db down'); activity.push(m); },
      };
      try { return await work(tx); } catch (e) { processed = sp; facts = sf; activity = sa; throw e; }
    },
  };
  return { uow, get processed() { return processed; }, get facts() { return facts; }, get activity() { return activity; } };
}

describe('HandleEventUseCase', () => {
  it('applies a valid event: marks it, merges the fact and records the activity', async () => {
    const db = fakeDb();
    expect(await new HandleEventUseCase(db.uow).execute(approved())).toBe('applied');
    expect(db.processed.size).toBe(1);
    expect(db.facts.get('m2')).toMatchObject({ milestoneId: 'm2', amountCop: 5_000_000, approvedBy: 'laura.rios@nexus.example' });
    expect(db.activity).toHaveLength(1);
  });
  it('ignores a repeated event (same eventId): nothing is added twice', async () => {
    const db = fakeDb(); const uc = new HandleEventUseCase(db.uow);
    await uc.execute(approved()); expect(await uc.execute(approved())).toBe('duplicate');
    expect(db.processed.size).toBe(1); expect(db.activity).toHaveLength(1);
  });
  it.each(['merge', 'activity'] as const)('if %s fails, nothing stays (all or nothing) so the retry can finish the job', async (where) => {
    const db = fakeDb(where);
    await expect(new HandleEventUseCase(db.uow).execute(approved())).rejects.toThrow('db down');
    expect(db.processed.size).toBe(0); expect(db.facts.size).toBe(0); expect(db.activity).toHaveLength(0);
  });
  it('rejects an invalid message before touching the database', async () => {
    const db = fakeDb();
    await expect(new HandleEventUseCase(db.uow).execute({ ...approved(), type: 'Nope' })).rejects.toBeInstanceOf(InvalidEventError);
    expect(db.processed.size).toBe(0);
  });
});
