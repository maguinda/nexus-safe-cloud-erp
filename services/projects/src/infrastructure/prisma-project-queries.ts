import { PrismaClient } from '@prisma/client';
import { Milestone } from '../domain/milestone';
import { ProjectQueries, ProjectSummary } from '../domain/ports';

export class PrismaProjectQueries implements ProjectQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async listProjects(): Promise<ProjectSummary[]> {
    const rows = await this.prisma.project.findMany({ orderBy: { id: 'asc' }, include: { milestones: { select: { status: true } } } });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      client: p.client,
      milestonesApproved: p.milestones.filter((m) => m.status === 'approved').length,
      milestonesTotal: p.milestones.length,
    }));
  }

  async listMilestones(projectId: string): Promise<Milestone[] | null> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return null;
    const rows = await this.prisma.milestone.findMany({ where: { projectId }, orderBy: { id: 'asc' } });
    return rows.map((m) => ({ id: m.id, projectId: m.projectId, name: m.name, amountCop: m.amountCop, status: m.status, approvedAt: m.approvedAt, approvedBy: m.approvedBy }));
  }

  async listTeam(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    if (!project) return null;
    const rows = await this.prisma.projectTeamMember.findMany({ where: { projectName: project.name }, orderBy: [{ periodStart: 'asc' }, { engineerName: 'asc' }, { percent: 'asc' }, { allocationId: 'asc' }], take: 200 });
    return rows.map((r) => ({ engineerName: r.engineerName, percent: r.percent, periodStart: r.periodStart.toISOString().slice(0, 10), periodEnd: r.periodEnd.toISOString().slice(0, 10) }));
  }
}
