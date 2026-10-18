import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ApproveMilestoneUseCase } from '../application/approve-milestone.use-case';
import { ListMilestonesUseCase, ListProjectsUseCase } from '../application/queries.use-cases';
import { AuthUser, Roles } from '../auth/auth.guard';
import { Milestone } from '../domain/milestone';
import { IdPipe } from './id.pipe';

export const LIST_PROJECTS = 'LIST_PROJECTS';
export const LIST_MILESTONES = 'LIST_MILESTONES';
export const APPROVE_MILESTONE = 'APPROVE_MILESTONE';

/** Solo los campos del contrato (docs/openapi.yaml): no se filtran datos internos. */
const toDto = (m: Milestone) => ({ id: m.id, projectId: m.projectId, name: m.name, amountCop: m.amountCop, status: m.status });

@ApiTags('Projects')
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(
    @Inject(LIST_PROJECTS) private readonly listProjects: ListProjectsUseCase,
    @Inject(LIST_MILESTONES) private readonly listMilestones: ListMilestonesUseCase,
    @Inject(APPROVE_MILESTONE) private readonly approveMilestone: ApproveMilestoneUseCase,
  ) {}

  @Get('projects')
  @ApiOperation({ summary: 'List projects with their approval progress' })
  projects() {
    return this.listProjects.execute();
  }

  @Get('projects/:projectId/milestones')
  @ApiOperation({ summary: 'List the milestones of a project' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async milestones(@Param('projectId', new IdPipe()) projectId: string) {
    return (await this.listMilestones.execute(projectId)).map(toDto);
  }

  @Post('milestones/:milestoneId/approve')
  @HttpCode(200)
  @Roles('project_lead')
  @ApiOperation({ summary: 'Approve a milestone (role project_lead)' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  @ApiResponse({ status: 409, description: 'Milestone already approved' })
  async approve(@Param('milestoneId', new IdPipe()) milestoneId: string, @Req() req: Request) {
    // Quién aprueba sale del token verificado, nunca del cuerpo de la petición.
    const user = (req as any).user as AuthUser;
    const r = await this.approveMilestone.execute(milestoneId, user.email, (req as any).correlationId);
    return { milestone: toDto(r.milestone), eventId: r.eventId };
  }
}
