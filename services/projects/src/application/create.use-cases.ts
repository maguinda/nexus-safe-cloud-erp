import { ProjectNotFoundError } from '../domain/errors';
import { newMilestone } from '../domain/milestone';
import { ProjectCommands } from '../domain/ports';
import { newProject } from '../domain/project';

export class CreateProjectUseCase {
  constructor(private readonly commands: ProjectCommands) {}
  async execute(name: unknown, client: unknown) {
    const project = newProject(name, client);
    await this.commands.insertProject(project);
    return { ...project, milestonesApproved: 0, milestonesTotal: 0 };
  }
}

export class CreateMilestoneUseCase {
  constructor(private readonly commands: ProjectCommands) {}
  async execute(projectId: string, name: unknown, amountCop: unknown) {
    const milestone = newMilestone(projectId, name, amountCop);
    if (!(await this.commands.insertMilestone(milestone))) throw new ProjectNotFoundError(projectId);
    return milestone;
  }
}
