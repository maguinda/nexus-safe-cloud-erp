import { BadRequestException } from '@nestjs/common';
import { buildTrends } from '../domain/trends';
import { DevicesFilter, LinksFilter, NetworkExplorer, ReadingsFilter, TelemetryExplorer, TrendsQueries } from '../domain/ports';

export class GetTrendsUseCase {
  constructor(private readonly q: TrendsQueries, private readonly clock: () => Date = () => new Date()) {}
  async execute() {
    const [buckets, perLocation, events, tempWarningC, window] = await Promise.all([this.q.buckets(), this.q.perLocation(), this.q.events(), this.q.tempWarningC(), this.q.window()]);
    return buildTrends({ buckets, perLocation, events, tempWarningC, window }, this.clock());
  }
}

export class ExploreReadingsUseCase {
  constructor(private readonly explorer: TelemetryExplorer) {}
  async readings(f: ReadingsFilter) {
    if (f.from && f.to && f.from.getTime() > f.to.getTime()) throw new BadRequestException('from must not be after to');
    const { total, items } = await this.explorer.readings(f);
    return { total, limit: f.limit, offset: f.offset, items };
  }
  facets() { return this.explorer.facets(); }
}

export class ExploreNetworkUseCase {
  constructor(private readonly explorer: NetworkExplorer) {}
  async devices(f: DevicesFilter) { const { total, items } = await this.explorer.devices(f); return { total, limit: f.limit, offset: f.offset, items }; }
  async links(f: LinksFilter) { const { total, items } = await this.explorer.links(f); return { total, limit: f.limit, offset: f.offset, items }; }
  facets() { return this.explorer.facets(); }
}
