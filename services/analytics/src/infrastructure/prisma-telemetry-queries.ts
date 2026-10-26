import { PrismaClient } from '@prisma/client';
import { TelemetryQueries } from '../domain/ports';
import { ATTENTION_STATUSES, AttentionReading, DeviceCounters, DeviceRow, LatestReading, LocationAverage, severityOf, StatusCount } from '../domain/telemetry';

export class PrismaTelemetryQueries implements TelemetryQueries {
  constructor(private readonly prisma: PrismaClient) {}

  devices(): Promise<DeviceRow[]> {
    return this.prisma.iotDevice.findMany({ orderBy: { id: 'asc' } });
  }

  /** Una fila por dispositivo: su lectura más reciente. */
  latestPerDevice(): Promise<LatestReading[]> {
    return this.prisma.$queryRaw<LatestReading[]>`
      SELECT DISTINCT ON (device_id) device_id AS "deviceId", recorded_at AS "recordedAt", status, value, unit, note
      FROM iot_readings ORDER BY device_id, recorded_at DESC, id DESC`;
  }

  async statusCounts(): Promise<StatusCount[]> {
    const rows = await this.prisma.iotReading.groupBy({ by: ['status'], _count: { _all: true } });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }

  /** Advertencias y alertas por dispositivo; qué estado es qué lo decide el dominio (severityOf), no el SQL. */
  async countersPerDevice(): Promise<DeviceCounters[]> {
    const rows = await this.prisma.iotReading.groupBy({ by: ['deviceId', 'status'], _count: { _all: true } });
    const out = new Map<string, DeviceCounters>();
    for (const r of rows) {
      const sev = severityOf(r.status);
      if (sev === 'normal') continue;
      const c = out.get(r.deviceId) ?? { deviceId: r.deviceId, warnings: 0, alerts: 0 };
      if (sev === 'alert') c.alerts += r._count._all; else c.warnings += r._count._all;
      out.set(r.deviceId, c);
    }
    return [...out.values()];
  }

  averagesByLocation(): Promise<LocationAverage[]> {
    return this.prisma.$queryRaw<LocationAverage[]>`
      SELECT d.location, d.reading_kind AS "readingKind", AVG(r.value)::float8 AS avg
      FROM iot_readings r JOIN iot_devices d ON d.id = r.device_id
      WHERE d.reading_kind IN ('TEMP', 'HUMIDITY') GROUP BY d.location, d.reading_kind`;
  }

  /** Las alertas primero y, con el cupo que sobre, las advertencias más recientes: 3 alertas viejas no deben quedar tapadas por 8 advertencias nuevas. */
  async attention(limit: number): Promise<AttentionReading[]> {
    const out: AttentionReading[] = [];
    for (const status of ATTENTION_STATUSES) {
      if (out.length >= limit) break;
      out.push(...await this.prisma.iotReading.findMany({
        where: { status }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], take: limit - out.length,
        select: { recordedAt: true, deviceId: true, status: true, value: true, unit: true, note: true },
      }));
    }
    return out;
  }

  async window(): Promise<{ from: Date; to: Date } | null> {
    const a = await this.prisma.iotReading.aggregate({ _min: { recordedAt: true }, _max: { recordedAt: true } });
    return a._min.recordedAt && a._max.recordedAt ? { from: a._min.recordedAt, to: a._max.recordedAt } : null;
  }
}
