import { ProjectNotFoundError } from '../domain/errors';
import { ProjectQueries } from '../domain/ports';

export class ListProjectsUseCase {
  constructor(private readonly queries: ProjectQueries) {}
  execute() { return this.queries.listProjects(); }
}

export class ListTeamUseCase {
  constructor(private readonly queries: ProjectQueries) {}
  async execute(projectId: string) {
    const list = await this.queries.listTeam(projectId);
    if (!list) throw new ProjectNotFoundError(projectId);
    return list;
  }
}

export class ListMilestonesUseCase {
  constructor(private readonly queries: ProjectQueries) {}
  async execute(projectId: string) {
    const list = await this.queries.listMilestones(projectId);
    if (!list) throw new ProjectNotFoundError(projectId);
    return list;
  }
}
