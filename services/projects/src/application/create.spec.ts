import { InvalidInputError, ProjectNotFoundError } from '../domain/errors';
import { newMilestone } from '../domain/milestone';
import { MAX_MILESTONE_AMOUNT_COP, newProject } from '../domain/project';
import { ProjectEvent, routingKeyOf } from '../domain/events';
import { ProjectCommands, TransactionScope, UnitOfWork } from '../domain/ports';
import { CreateMilestoneUseCase, CreateProjectUseCase } from './create.use-cases';

describe('newProject', () => {
  it('creates a project with a server-made id and cleaned text', () => {
    const p = newProject('  Warehouse   Wi-Fi \t rollout ', ' Nexus Safe-Cloud ');
    expect(p).toEqual({ id: expect.stringMatching(/^p-[0-9a-f]{8}$/), name: 'Warehouse Wi-Fi rollout', client: 'Nexus Safe-Cloud' });
  });
  it('never repeats an id', () => {
    expect(new Set(Array.from({ length: 2000 }, () => newProject('a', 'b').id)).size).toBe(2000);
  });
  it.each([[''], ['   '], ['a'.repeat(121)], ['bad\u0000name'], ['line\u001fbreak'], [123], [null], [undefined], [{ a: 1 }], [['x']]])('rejects the name %p', (bad) => {
    expect(() => newProject(bad, 'client')).toThrow(InvalidInputError);
  });
  it('accepts exactly 120 characters and keeps accents, emojis and markup as plain text', () => {
    expect(newProject('a'.repeat(120), 'c').name).toHaveLength(120);
    expect(newProject('Instalación ñandú 🚀 <b>x</b>', 'c').name).toBe('Instalación ñandú 🚀 <b>x</b>');
  });
});

describe('newMilestone', () => {
  it('is born pending, without approval data, with a server-made id', () => {
    expect(newMilestone('p1', ' Site survey ', 12_000_000)).toEqual({ id: expect.stringMatching(/^m-[0-9a-f]{8}$/), projectId: 'p1', name: 'Site survey', amountCop: 12_000_000, status: 'pending', approvedAt: null, approvedBy: null });
  });
  it.each([[1], [MAX_MILESTONE_AMOUNT_COP]])('accepts the limit amount %i', (a) => { expect(newMilestone('p1', 'm', a).amountCop).toBe(a); });
  it.each([[0], [-1], [1.5], [MAX_MILESTONE_AMOUNT_COP + 1], [Number.NaN], [Infinity], ['100'], [null], [undefined], [9e15]])('rejects the amount %p', (bad) => {
    expect(() => newMilestone('p1', 'm', bad)).toThrow(InvalidInputError);
  });
  it('rejects a bad name', () => { expect(() => newMilestone('p1', '', 5)).toThrow(InvalidInputError); });
});

describe('create use cases', () => {
  /** Base en memoria con transacción simulada: si el trabajo falla, no queda nada (ni el hito ni su evento). */
  const fake = (known: string[] = ['p1'], failOutbox = false) => {
    const projects: any[] = []; let milestones: any[] = []; let outbox: ProjectEvent[] = [];
    const commands: ProjectCommands = { insertProject: async (p) => { projects.push(p); } };
    const uow: UnitOfWork = {
      async run(work) {
        const snapM = [...milestones], snapO = [...outbox];
        const tx: TransactionScope = {
          findMilestoneForUpdate: async () => null, saveMilestone: async () => undefined,
          findProjectName: async (id) => (known.includes(id) ? 'Branch network upgrade' : null),
          insertMilestone: async (m) => { milestones.push(m); },
          addToOutbox: async (e) => { if (failOutbox) throw new Error('outbox down'); outbox.push(e); },
        };
        try { return await work(tx); } catch (e) { milestones = snapM; outbox = snapO; throw e; }
      },
    };
    return { commands, uow, projects, get milestones() { return milestones; }, get outbox() { return outbox; } };
  };
  const NOW = new Date('2026-10-28T12:00:00.000Z');
  it('CreateProject stores the project and answers with zero milestones', async () => {
    const f = fake();
    const r = await new CreateProjectUseCase(f.commands).execute('P', 'C');
    expect(f.projects).toHaveLength(1);
    expect(r).toMatchObject({ name: 'P', client: 'C', milestonesApproved: 0, milestonesTotal: 0 });
  });
  it('CreateProject stores nothing when the input is invalid', async () => {
    const f = fake();
    await expect(new CreateProjectUseCase(f.commands).execute('', 'C')).rejects.toBeInstanceOf(InvalidInputError);
    expect(f.projects).toHaveLength(0);
  });
  it('CreateMilestone stores a pending milestone for an existing project', async () => {
    const f = fake();
    const m = await new CreateMilestoneUseCase(f.uow, () => NOW).execute('p1', 'Design', 5_000_000, 'corr-1');
    expect(f.milestones).toEqual([m]);
    expect(m.status).toBe('pending');
  });
  it('CreateMilestone writes the MilestoneCreated event in the same transaction, with the project name and the correlation id', async () => {
    const f = fake();
    const m = await new CreateMilestoneUseCase(f.uow, () => NOW).execute('p1', 'Design', 5_000_000, 'corr-1');
    expect(f.outbox).toHaveLength(1);
    expect(f.outbox[0]).toMatchObject({
      type: 'MilestoneCreated', occurredAt: NOW.toISOString(), correlationId: 'corr-1',
      data: { milestoneId: m.id, milestoneName: 'Design', projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 5_000_000 },
    });
    expect(routingKeyOf(f.outbox[0])).toBe('project.milestone.created');
  });
  it('if the event cannot be written the milestone is NOT left behind (all or nothing)', async () => {
    const f = fake(['p1'], true);
    await expect(new CreateMilestoneUseCase(f.uow).execute('p1', 'Design', 5, 'corr-1')).rejects.toThrow('outbox down');
    expect(f.milestones).toHaveLength(0);
  });
  it('CreateMilestone answers "not found" for an unknown project and stores neither the milestone nor an event', async () => {
    const f = fake();
    await expect(new CreateMilestoneUseCase(f.uow).execute('nope', 'Design', 5, 'corr-1')).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(f.milestones).toHaveLength(0);
    expect(f.outbox).toHaveLength(0);
  });
  it('CreateMilestone validates BEFORE touching the database', async () => {
    const f = fake();
    await expect(new CreateMilestoneUseCase(f.uow).execute('p1', 'Design', -5, 'corr-1')).rejects.toBeInstanceOf(InvalidInputError);
    expect(f.milestones).toHaveLength(0);
    expect(f.outbox).toHaveLength(0);
  });
});
