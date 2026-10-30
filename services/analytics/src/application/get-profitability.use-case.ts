import { PrismaClient } from '@prisma/client';
import { DashboardQueries } from '../domain/ports';
import { buildProfitability } from '../domain/profitability';
import { allocationFacts } from '../infrastructure/prisma-allocation-store';

export class GetProfitabilityUseCase {
  constructor(private readonly queries: DashboardQueries, private readonly prisma: PrismaClient, private readonly clock: () => Date = () => new Date()) {}

  async execute() {
    const [facts, allocations] = await Promise.all([this.queries.facts(), allocationFacts(this.prisma)]);
    return buildProfitability(facts, allocations, this.clock());
  }
}
