import { PrismaClient } from '@prisma/client';
import { Allocation } from '../domain/allocation';
import { Engineer } from '../domain/engineer';
import { CapacityQueries, EngineerCommands } from '../domain/ports';
import { dateDay } from './prisma-unit-of-work';

export class PrismaCapacity implements CapacityQueries, EngineerCommands {
  constructor(private readonly prisma: PrismaClient) {}

  async insertEngineer(e: Engineer): Promise<void> {
    await this.prisma.engineer.create({ data: { id: e.id, name: e.name, role: e.role, position: e.position, kind: e.kind, skills: e.skills, certifications: e.certifications, monthlySalaryCop: e.monthlySalaryCop, dailyCostCop: e.dailyCostCop } });
  }

  async setSalary(id: string, salary: number | null, daily: number | null): Promise<boolean> {
    const n = await this.prisma.engineer.updateMany({ where: { id }, data: { monthlySalaryCop: salary, dailyCostCop: daily } });
    return n.count === 1;
  }

  async engineersWithAllocations(today: number) {
    const rows = await this.prisma.engineer.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], include: { allocations: { where: { endDate: { gte: new Date(today * 86_400_000) } }, orderBy: [{ startDate: 'asc' }, { id: 'asc' }] } } });
    return rows.map((r) => ({
      engineer: { id: r.id, name: r.name, role: r.role, position: r.position as Engineer['position'], kind: r.kind as Engineer['kind'], skills: r.skills, certifications: r.certifications, monthlySalaryCop: r.monthlySalaryCop, dailyCostCop: r.dailyCostCop },
      allocations: r.allocations.map((a): Allocation & { overAllocated: boolean } => ({ id: a.id, engineerId: r.id, projectName: a.projectName, kind: a.kind as 'project' | 'maintenance', percent: a.percent, start: dateDay(a.startDate), end: dateDay(a.endDate), overAllocated: a.overAllocated })),
    }));
  }
}
