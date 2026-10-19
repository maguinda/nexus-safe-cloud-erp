import { MilestoneApprovedEvent } from './events';
import { Milestone } from './milestone';
import { Project } from './project';

export interface ProjectSummary {
  id: string;
  name: string;
  client: string;
  milestonesApproved: number;
  milestonesTotal: number;
}

/** Lecturas: no necesitan transacción. */
export interface ProjectQueries {
  listProjects(): Promise<ProjectSummary[]>;
  /** null si el proyecto no existe. */
  listMilestones(projectId: string): Promise<Milestone[] | null>;
}

/** Lo que se puede hacer dentro de UNA transacción de base de datos. */
export interface TransactionScope {
  /** Bloquea la fila del hito hasta el final de la transacción (SELECT ... FOR UPDATE). */
  findMilestoneForUpdate(id: string): Promise<{ milestone: Milestone; projectName: string } | null>;
  saveMilestone(m: Milestone): Promise<void>;
  addToOutbox(event: MilestoneApprovedEvent): Promise<void>;
}

export interface UnitOfWork {
  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T>;
}

/** Altas: crear proyectos e hitos. */
export interface ProjectCommands {
  insertProject(p: Project): Promise<void>;
  /** false si el proyecto no existe. */
  insertMilestone(m: Milestone): Promise<boolean>;
}
