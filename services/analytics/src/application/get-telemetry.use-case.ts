import { TelemetryQueries } from '../domain/ports';
import { buildTelemetrySummary } from '../domain/telemetry';

export class GetTelemetryUseCase {
  constructor(private readonly queries: TelemetryQueries, private readonly clock: () => Date = () => new Date()) {}

  async execute() {
    const q = this.queries;
    const [devices, latest, statusCounts, perDevice, averages, attention, window] = await Promise.all([
      q.devices(), q.latestPerDevice(), q.statusCounts(), q.countersPerDevice(), q.averagesByLocation(), q.attention(8), q.window(),
    ]);
    return buildTelemetrySummary({ devices, latest, statusCounts, perDevice, averages, attention, window }, this.clock());
  }
}
