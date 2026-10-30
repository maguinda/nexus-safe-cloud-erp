import { PrismaClient } from '@prisma/client';
import { Allocation } from '../domain/allocation';
import { Engineer } from '../domain/engineer';
import { CapacityQueries, EngineerCommands } from '../domain/ports';
import { dateDay } from './prisma-unit-of-work';

export class PrismaCapacity implements CapacityQueries, EngineerCommands {
  constructor(private readonly prisma: PrismaClient) {}

  async insertEngineer(e: Engineer): Promise<void> {
    await this.prisma.engineer.create({ data: { id: e.id, name: e.name, role: e.role, skills: e.skills, certifications: e.certifications, dailyCostCop: e.dailyCostCop } });
  }

  async setDailyCost(id: string, cost: number | null): Promise<boolean> {
    const n = await this.prisma.engineer.updateMany({ where: { id }, data: { dailyCostCop: cost } });
    return n.count === 1;
  }

  async engineersWithAllocations(today: number) {
    const rows = await this.prisma.engineer.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], include: { allocations: { where: { endDate: { gte: new Date(today * 86_400_000) } }, orderBy: [{ startDate: 'asc' }, { id: 'asc' }] } } });
    return rows.map((r) => ({
      engineer: { id: r.id, name: r.name, role: r.role, skills: r.skills, certifications: r.certifications, dailyCostCop: r.dailyCostCop },
      allocations: r.allocations.map((a): Allocation & { overAllocated: boolean } => ({ id: a.id, engineerId: r.id, projectName: a.projectName, percent: a.percent, start: dateDay(a.startDate), end: dateDay(a.endDate), overAllocated: a.overAllocated })),
    }));
  }
}
