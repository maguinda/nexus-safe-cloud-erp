import { ProjectNotFoundError } from '../domain/errors';
import { milestoneCreated } from '../domain/events';
import { newMilestone } from '../domain/milestone';
import { ProjectCommands, UnitOfWork } from '../domain/ports';
import { newProject } from '../domain/project';

export class CreateProjectUseCase {
  constructor(private readonly commands: ProjectCommands) {}
  async execute(name: unknown, client: unknown) {
    const project = newProject(name, client);
    await this.commands.insertProject(project);
    return { ...project, milestonesApproved: 0, milestonesTotal: 0 };
  }
}

/** El hito y su evento `MilestoneCreated` (outbox) van en UNA transacción: si falla una cosa, no queda la otra. */
export class CreateMilestoneUseCase {
  constructor(private readonly uow: UnitOfWork, private readonly clock: () => Date = () => new Date()) {}
  async execute(projectId: string, name: unknown, amountCop: unknown, correlationId: string) {
    const milestone = newMilestone(projectId, name, amountCop);
    return this.uow.run(async (tx) => {
      const projectName = await tx.findProjectName(projectId);
      if (projectName === null) throw new ProjectNotFoundError(projectId);
      await tx.insertMilestone(milestone);
      await tx.addToOutbox(milestoneCreated(milestone, projectName, correlationId, this.clock()));
      return milestone;
    });
  }
}
