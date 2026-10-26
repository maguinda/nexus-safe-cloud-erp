import { NetworkQueries } from '../domain/ports';
import { buildNetworkSummary } from '../domain/network';

export class GetNetworkUseCase {
  constructor(private readonly queries: NetworkQueries, private readonly clock: () => Date = () => new Date()) {}

  async execute() {
    const q = this.queries;
    const [byCategory, byCriticality, links, infrastructure] = await Promise.all([q.devicesByCategory(), q.devicesByCriticality(), q.links(), q.infrastructure()]);
    return buildNetworkSummary({ byCategory, byCriticality, links, infrastructure }, this.clock());
  }
}
