import { Prisma, PrismaClient } from '@prisma/client';
import { Milestone } from '../domain/milestone';
import { ProjectCommands } from '../domain/ports';
import { Project } from '../domain/project';

export class PrismaProjectCommands implements ProjectCommands {
  constructor(private readonly prisma: PrismaClient) {}

  async insertProject(p: Project): Promise<void> {
    await this.prisma.project.create({ data: { id: p.id, name: p.name, client: p.client } });
  }

  async insertMilestone(m: Milestone): Promise<boolean> {
    try {
      await this.prisma.milestone.create({ data: { id: m.id, projectId: m.projectId, name: m.name, amountCop: m.amountCop, status: 'pending' } });
      return true;
    } catch (e) {
      // P2003: la llave foránea falló, es decir, el proyecto no existe (o lo borraron justo ahora).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') return false;
      throw e;
    }
  }
}
