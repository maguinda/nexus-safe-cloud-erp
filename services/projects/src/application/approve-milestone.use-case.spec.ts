import { ApproveMilestoneUseCase } from './approve-milestone.use-case';
import { MilestoneAlreadyApprovedError, MilestoneNotFoundError } from '../domain/errors';
import { ProjectEvent } from '../domain/events';
import { Milestone } from '../domain/milestone';
import { TransactionScope, UnitOfWork } from '../domain/ports';

const pending: Milestone = { id: 'm2', projectId: 'p1', name: 'Link redundancy design', amountCop: 18_500_000, status: 'pending', approvedAt: null, approvedBy: null };
const NOW = new Date('2026-10-18T05:30:00.000Z');

/** Base en memoria con transacción real simulada: si el trabajo falla, no queda nada guardado. */
function fakeUow(initial: Milestone[]) {
  let store = new Map(initial.map((m) => [m.id, m]));
  let outbox: ProjectEvent[] = [];
  const uow: UnitOfWork = {
    async run(work) {
      const snapStore = new Map(store);
      const snapOutbox = [...outbox];
      const tx: TransactionScope = {
        findMilestoneForUpdate: async (id) => (store.has(id) ? { milestone: store.get(id) as Milestone, projectName: 'Branch network upgrade' } : null),
        saveMilestone: async (m) => { store.set(m.id, m); },
        findProjectName: async () => 'Branch network upgrade',
        insertMilestone: async (m) => { store.set(m.id, m); },
        addToOutbox: async (e) => { outbox.push(e); },
      };
      try { return await work(tx); } catch (e) { store = snapStore; outbox = snapOutbox; throw e; }
    },
  };
  return { uow, get store() { return store; }, get outbox() { return outbox; } };
}

describe('ApproveMilestoneUseCase', () => {
  it('approves the milestone and writes the event in the same unit of work', async () => {
    const db = fakeUow([pending]);
    const r = await new ApproveMilestoneUseCase(db.uow, () => NOW).execute('m2', 'laura.rios@nexus.example', 'corr-1');
    expect(r.milestone.status).toBe('approved');
    expect(db.store.get('m2')?.approvedBy).toBe('laura.rios@nexus.example');
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]).toMatchObject({
      eventId: r.eventId, type: 'MilestoneApproved', occurredAt: NOW.toISOString(), correlationId: 'corr-1',
      data: { milestoneId: 'm2', projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 18_500_000, approvedBy: 'laura.rios@nexus.example' },
    });
  });

  it('answers 409-type error when the milestone is already approved and writes no second event', async () => {
    const db = fakeUow([pending]);
    const useCase = new ApproveMilestoneUseCase(db.uow, () => NOW);
    await useCase.execute('m2', 'a@x.co', 'c1');
    await expect(useCase.execute('m2', 'b@x.co', 'c2')).rejects.toBeInstanceOf(MilestoneAlreadyApprovedError);
    expect(db.outbox).toHaveLength(1);
    expect(db.store.get('m2')?.approvedBy).toBe('a@x.co'); // el primero se queda
  });

  it('fails with not found for an unknown milestone', async () => {
    const db = fakeUow([pending]);
    await expect(new ApproveMilestoneUseCase(db.uow).execute('nope', 'a@x.co', 'c')).rejects.toBeInstanceOf(MilestoneNotFoundError);
    expect(db.outbox).toHaveLength(0);
  });

  it('leaves nothing behind if the outbox write fails (atomicity)', async () => {
    const db = fakeUow([pending]);
    const broken: UnitOfWork = { run: (work) => db.uow.run((tx) => work({ ...tx, addToOutbox: async () => { throw new Error('disk full'); } })) };
    await expect(new ApproveMilestoneUseCase(broken, () => NOW).execute('m2', 'a@x.co', 'c')).rejects.toThrow('disk full');
    expect(db.store.get('m2')?.status).toBe('pending');
    expect(db.outbox).toHaveLength(0);
  });

  it('does not mutate the original milestone object', async () => {
    const original = { ...pending };
    const db = fakeUow([original]);
    await new ApproveMilestoneUseCase(db.uow, () => NOW).execute('m2', 'a@x.co', 'c');
    expect(original.status).toBe('pending');
  });
});
