import { BadRequestException } from '@nestjs/common';
import { buildTrends, DEFAULT_RANGE, EVENTS_FOR_INSIGHTS, isRangeKey, RANGES, rangeFor } from '../domain/trends';
import { DevicesFilter, LinksFilter, NetworkExplorer, ReadingsFilter, TelemetryExplorer, TrendsQueries } from '../domain/ports';

export class GetTrendsUseCase {
  constructor(private readonly q: TrendsQueries, private readonly clock: () => Date = () => new Date()) {}
  /** Las tendencias del rango pedido (por defecto, las últimas 24 h de DATOS: el "ahora" es la lectura más reciente). */
  async execute(rangeKey: string = DEFAULT_RANGE) {
    if (!isRangeKey(rangeKey)) throw new BadRequestException(`range must be one of: ${Object.keys(RANGES).join(', ')}`);
    const [window, tempWarningC] = await Promise.all([this.q.window(), this.q.tempWarningC()]);
    if (!window) return buildTrends({ window, range: null, eventsTotal: 0, statusCounts: [], buckets: [], perLocation: [], events: [], tempWarningC }, this.clock());
    const range = rangeFor(rangeKey, window.to);
    const [buckets, perLocation, events, statusCounts] = await Promise.all([this.q.buckets(range), this.q.perLocation(range), this.q.events(range, EVENTS_FOR_INSIGHTS), this.q.statusCounts(range)]);
    return buildTrends({ window, range, eventsTotal: events.total, statusCounts, buckets, perLocation, events: events.rows, tempWarningC }, this.clock());
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
