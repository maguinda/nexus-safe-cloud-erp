import { Prisma, PrismaClient } from '@prisma/client';
import { ActivityStatus, canProgress, cleanDay, cleanLine, cleanNote, cleanStaffId, isLive, newActivity, progressOf } from '../domain/activity';
import { ActivityNotFoundError, ActivityStateError, InvalidInputError, MilestoneNotFoundError, ProjectNotFoundError } from '../domain/errors';

const TX = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 10_000 } as const;
export type Actor = { id: string; email: string; role: string; staffId?: string };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const code = (n: number) => `A-${String(n).padStart(4, '0')}`;

type Row = {
  id: string; number: number; milestoneId: string; title: string; description: string | null; status: string; dueDate: Date | null;
  assignedTo: string; assignedToId: string; createdBy: string; createdAt: Date; startedAt: Date | null; doneAt: Date | null; doneBy: string | null; doneNote: string | null; cancelledAt: Date | null;
};
/** Solo los campos del contrato. */
export const toView = (a: Row) => ({
  id: a.id, code: code(a.number), milestoneId: a.milestoneId, title: a.title, description: a.description, status: a.status as ActivityStatus, dueDate: day(a.dueDate),
  assignedTo: a.assignedTo, assignedToId: a.assignedToId, createdBy: a.createdBy, createdAt: a.createdAt.toISOString(), startedAt: a.startedAt?.toISOString() ?? null,
  doneAt: a.doneAt?.toISOString() ?? null, doneBy: a.doneBy, doneNote: a.doneNote, cancelledAt: a.cancelledAt?.toISOString() ?? null,
});

/**
 * Responsable de cada hito y actividades de un hito.
 *  - Gerencia y líder de proyecto asignan el INGENIERO responsable de un hito y ven todas las actividades.
 *  - El ingeniero responsable crea las actividades de SUS hitos, las reasigna y las cancela; un hito ajeno responde 404 (igual que uno inexistente).
 *  - El técnico ve y va completando SOLO las que le asignaron; una ajena responde 404.
 * La persona sale SIEMPRE del token firmado (`staffId`), nunca del cuerpo. Las órdenes de mantenimiento no viven aquí: no pertenecen a ningún proyecto.
 * Bloqueos (orden fijo, sin ciclos): hito → actividad. Quien cambia de estado una actividad bloquea su fila y RELEE el estado dentro del bloqueo.
 */
export class ActivitiesService {
  constructor(private readonly prisma: PrismaClient, private readonly clock: () => Date = () => new Date()) {}
  private today() { return this.clock().toISOString().slice(0, 10); }

  /** Gerencia y líder gestionan cualquiera; el ingeniero solo los hitos de los que es responsable. */
  private canManage(a: Actor, ownerId: string | null): boolean {
    if (a.role === 'manager' || a.role === 'project_lead') return true;
    return a.role === 'engineer' && ownerId !== null && a.staffId !== undefined && ownerId === a.staffId;
  }

  private async lockMilestone(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<{ id: string; status: string; ownerId: string | null }[]>`SELECT id, status::text AS status, owner_id AS "ownerId" FROM milestones WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) throw new MilestoneNotFoundError(id);
    return rows[0];
  }

  /** Gerencia o líder eligen (o quitan) al ingeniero responsable. Un hito ya aprobado no cambia de responsable. */
  async setOwner(milestoneId: string, ownerId: unknown, ownerName: unknown) {
    const owner = ownerId === null || ownerId === undefined ? null : { id: cleanStaffId(ownerId, 'ownerId'), name: cleanLine(ownerName, 'ownerName', 2, 100) };
    return this.prisma.$transaction(async (tx) => {
      const m = await this.lockMilestone(tx, milestoneId);
      if (m.status === 'approved') throw new ActivityStateError('An approved milestone no longer changes its owner');
      await tx.$executeRaw`UPDATE milestones SET owner_id = ${owner?.id ?? null}::uuid, owner_name = ${owner?.name ?? null} WHERE id = ${milestoneId}`;
      return { milestoneId, ownerId: owner?.id ?? null, ownerName: owner?.name ?? null };
    }, TX);
  }

  /** Por hito de un proyecto: responsable y avance de sus actividades (para el líder y gerencia). */
  async progressByProject(projectId: string) {
    const exists = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!exists) throw new ProjectNotFoundError(projectId);
    const ms = await this.prisma.milestone.findMany({ where: { projectId }, orderBy: { id: 'asc' }, select: { id: true, ownerId: true, ownerName: true, activities: { select: { status: true } } } });
    return ms.map((m) => ({ milestoneId: m.id, ownerId: m.ownerId, ownerName: m.ownerName, progress: progressOf(m.activities as { status: ActivityStatus }[]) }));
  }

  /** El ingeniero: sus hitos con el proyecto, el estado y sus actividades. Sin dinero: el hito no muestra su monto. */
  async myMilestones(actor: Actor) {
    const ms = await this.prisma.milestone.findMany({
      where: { ownerId: actor.staffId ?? '00000000-0000-0000-0000-000000000000' },
      orderBy: [{ projectId: 'asc' }, { id: 'asc' }],
      include: { project: { select: { id: true, name: true } }, activities: { orderBy: { number: 'asc' } } },
    });
    return ms.map((m) => ({
      milestoneId: m.id, name: m.name, status: m.status, projectId: m.project.id, projectName: m.project.name,
      progress: progressOf(m.activities as unknown as { status: ActivityStatus }[]), activities: m.activities.map((a) => toView(a as Row)),
    }));
  }

  async listActivities(milestoneId: string, actor: Actor) {
    const m = await this.prisma.milestone.findUnique({ where: { id: milestoneId }, select: { id: true, ownerId: true } });
    if (!m || !this.canManage(actor, m.ownerId)) throw new MilestoneNotFoundError(milestoneId);
    const rows = await this.prisma.milestoneActivity.findMany({ where: { milestoneId }, orderBy: { number: 'asc' } });
    return rows.map((r) => toView(r as Row));
  }

  async create(milestoneId: string, actor: Actor, raw: Parameters<typeof newActivity>[0]) {
    const input = newActivity(raw, this.today()); // se valida ANTES de bloquear nada
    return this.prisma.$transaction(async (tx) => {
      const m = await this.lockMilestone(tx, milestoneId);
      if (!this.canManage(actor, m.ownerId)) throw new MilestoneNotFoundError(milestoneId);
      if (m.status === 'approved') throw new ActivityStateError('An approved milestone no longer takes new activities');
      const row = await tx.milestoneActivity.create({ data: { milestoneId, title: input.title, description: input.description, assignedToId: input.assignedToId, assignedTo: input.assignedTo, dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null, createdBy: actor.email } });
      return toView(row as Row);
    }, TX);
  }

  /** Hito primero y actividad después (siempre en ese orden); el hito se busca antes sin bloqueo para saber cuál bloquear. */
  private async lockActivity(tx: Prisma.TransactionClient, id: string, actor: Actor) {
    const pre = await tx.$queryRaw<{ milestoneId: string }[]>`SELECT milestone_id AS "milestoneId" FROM milestone_activities WHERE id = ${id}::uuid`;
    if (pre.length === 0) throw new ActivityNotFoundError();
    const m = await this.lockMilestone(tx, pre[0].milestoneId);
    if (!this.canManage(actor, m.ownerId)) throw new ActivityNotFoundError();
    const cur = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM milestone_activities WHERE id = ${id}::uuid FOR UPDATE`;
    if (cur.length === 0) throw new ActivityNotFoundError();
    const a = await tx.milestoneActivity.findUniqueOrThrow({ where: { id } });
    return a;
  }

  /** Editar o reasignar una actividad viva: solo cambia lo que llega. */
  async edit(id: string, actor: Actor, raw: { title?: unknown; description?: unknown; assignedToId?: unknown; assignedTo?: unknown; dueDate?: unknown }) {
    const data: Prisma.MilestoneActivityUpdateInput = {};
    if (raw.title !== undefined) data.title = cleanLine(raw.title, 'title', 3, 120);
    if (raw.description !== undefined) data.description = cleanNote(raw.description, 'description');
    if (raw.dueDate !== undefined) {
      if (raw.dueDate === null) data.dueDate = null;
      else { const d = cleanDay(raw.dueDate, 'dueDate'); if (d < this.today()) throw new InvalidInputError('dueDate must not be in the past'); data.dueDate = new Date(`${d}T00:00:00Z`); }
    }
    if (raw.assignedToId !== undefined || raw.assignedTo !== undefined) { data.assignedToId = cleanStaffId(raw.assignedToId, 'assignedToId'); data.assignedTo = cleanLine(raw.assignedTo, 'assignedTo', 2, 100); }
    if (Object.keys(data).length === 0) throw new InvalidInputError('Nothing to change');
    return this.prisma.$transaction(async (tx) => {
      const a = await this.lockActivity(tx, id, actor);
      if (!isLive(a.status as ActivityStatus)) throw new ActivityStateError('A finished or cancelled activity no longer changes');
      return toView((await tx.milestoneActivity.update({ where: { id }, data })) as Row);
    }, TX);
  }

  async cancel(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const a = await this.lockActivity(tx, id, actor);
      if (!isLive(a.status as ActivityStatus)) throw new ActivityStateError('A finished or cancelled activity cannot be cancelled');
      return toView((await tx.milestoneActivity.update({ where: { id }, data: { status: 'cancelled', cancelledAt: this.clock(), cancelledBy: actor.email } })) as Row);
    }, TX);
  }

  /** El técnico asignado la inicia o la termina. Ajena o inexistente = 404; estado que no corresponde = 409. */
  async progress(id: string, actor: Actor, status: unknown, note: unknown) {
    if (status !== 'in_progress' && status !== 'done') throw new InvalidInputError('status must be in_progress or done');
    const clean = cleanNote(note, 'note');
    if (clean !== null && status !== 'done') throw new InvalidInputError('A note only goes when finishing');
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM milestone_activities WHERE id = ${id}::uuid AND assigned_to_id = ${actor.staffId ?? '00000000-0000-0000-0000-000000000000'}::uuid FOR UPDATE`;
      if (cur.length === 0) throw new ActivityNotFoundError();
      const a = await tx.milestoneActivity.findUniqueOrThrow({ where: { id } }); // el estado se relee DENTRO del bloqueo
      if (!canProgress(a.status as ActivityStatus, status)) throw new ActivityStateError(`An activity that is ${a.status} cannot go to ${status}`);
      const now = this.clock();
      const data: Prisma.MilestoneActivityUpdateInput = status === 'in_progress' ? { status: 'in_progress', startedAt: now } : { status: 'done', doneAt: now, doneBy: actor.email, doneNote: clean, ...(a.startedAt ? {} : { startedAt: now }) };
      return toView((await tx.milestoneActivity.update({ where: { id }, data })) as Row);
    }, TX);
  }

  /** El técnico: solo lo que le asignaron, con el hito y el proyecto. Lo vivo primero. */
  async myActivities(actor: Actor) {
    const rows = await this.prisma.milestoneActivity.findMany({
      where: { assignedToId: actor.staffId ?? '00000000-0000-0000-0000-000000000000' },
      orderBy: { number: 'asc' },
      include: { milestone: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } },
    });
    const live = (s: string) => (isLive(s as ActivityStatus) ? 0 : 1);
    return rows
      .map((r) => ({ ...toView(r as unknown as Row), milestoneName: r.milestone.name, projectId: r.milestone.project.id, projectName: r.milestone.project.name }))
      .sort((a, b) => live(a.status) - live(b.status) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.code.localeCompare(b.code));
  }
}
