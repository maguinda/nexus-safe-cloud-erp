import { buildDashboard } from '../domain/dashboard';
import { DashboardQueries } from '../domain/ports';

export class GetDashboardUseCase {
  constructor(private readonly queries: DashboardQueries, private readonly clock: () => Date = () => new Date()) {}

  async execute() {
    const [facts, activity, processed] = await Promise.all([this.queries.facts(), this.queries.recentActivity(8), this.queries.eventsProcessed()]);
    return buildDashboard(facts, activity, processed, this.clock());
  }
}
