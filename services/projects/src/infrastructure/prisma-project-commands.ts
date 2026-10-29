import { PrismaClient } from '@prisma/client';
import { ProjectCommands } from '../domain/ports';
import { Project } from '../domain/project';

export class PrismaProjectCommands implements ProjectCommands {
  constructor(private readonly prisma: PrismaClient) {}

  async insertProject(p: Project): Promise<void> {
    await this.prisma.project.create({ data: { id: p.id, name: p.name, client: p.client } });
  }
}
