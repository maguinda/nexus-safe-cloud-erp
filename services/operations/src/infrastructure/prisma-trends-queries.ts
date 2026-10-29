import { Prisma, PrismaClient } from '@prisma/client';
import { TrendsQueries } from '../domain/ports';
import { ATTENTION_STATUSES } from '../domain/telemetry';
import { StatusCount } from '../domain/telemetry';
import { BucketRow, EventRow, LocationStat, RangeSpec } from '../domain/trends';

// Qué lectura es de qué cosa lo dice la FUENTE (reading_kind del dispositivo) y los estados son los de la fuente: se pasan como parámetros, no se repiten en el SQL.
const KIND = { temp: 'TEMP', humidity: 'HUMIDITY', smoke: 'SMOKE', power: 'POWER', motion: 'DETECTION', door: 'STATE' };
const ST = { detected: 'DETECTED', unlocked: 'UNLOCKED', on: 'ON', warning: 'WARNING', alert: 'ALERT' };
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export class PrismaTrendsQueries implements TrendsQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async buckets(r: RangeSpec): Promise<BucketRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT d.location, date_bin(${r.bucketMinutes}::int * INTERVAL '1 minute', r.recorded_at, TIMESTAMP '2000-01-01') AS bucket,
        AVG(r.value) FILTER (WHERE d.reading_kind = ${KIND.temp}) AS avg_temp, MAX(r.value) FILTER (WHERE d.reading_kind = ${KIND.temp}) AS max_temp,
        AVG(r.value) FILTER (WHERE d.reading_kind = ${KIND.humidity}) AS avg_hum, MAX(r.value) FILTER (WHERE d.reading_kind = ${KIND.smoke}) AS max_smoke,
        100.0 * COUNT(*) FILTER (WHERE d.reading_kind = ${KIND.power} AND r.status = ${ST.on}) / NULLIF(COUNT(*) FILTER (WHERE d.reading_kind = ${KIND.power}), 0) AS heater_on,
        COUNT(*) FILTER (WHERE r.status = ${ST.detected})::int AS detections, COUNT(*) FILTER (WHERE r.status = ${ST.unlocked})::int AS unlocks,
        COUNT(*) FILTER (WHERE r.status = ${ST.warning})::int AS warnings, COUNT(*) FILTER (WHERE r.status = ${ST.alert})::int AS alerts
      FROM iot_readings r JOIN iot_devices d ON d.id = r.device_id
      WHERE r.recorded_at >= ${r.from} AND r.recorded_at <= ${r.to}
      GROUP BY d.location, bucket ORDER BY d.location, bucket`);
    return rows.map((r) => ({
      location: String(r.location), bucket: new Date(String(r.bucket).includes('Z') || r.bucket instanceof Date ? (r.bucket as Date) : `${r.bucket}Z`),
      avgTempC: num(r.avg_temp), maxTempC: num(r.max_temp), avgHumidityPct: num(r.avg_hum), maxSmokePpm: num(r.max_smoke), heaterOnPct: num(r.heater_on),
      detections: Number(r.detections), unlocks: Number(r.unlocks), warnings: Number(r.warnings), alerts: Number(r.alerts),
    }));
  }

  async perLocation(r: RangeSpec): Promise<LocationStat[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT d.location,
        COUNT(*) FILTER (WHERE d.reading_kind = ${KIND.temp})::int AS temp_readings,
        COUNT(*) FILTER (WHERE d.reading_kind = ${KIND.temp} AND r.status = ${ST.warning})::int AS warning_readings,
        MAX(r.value) FILTER (WHERE d.reading_kind = ${KIND.temp}) AS peak,
        COUNT(*) FILTER (WHERE d.reading_kind = ${KIND.power})::int AS heater_readings,
        COUNT(*) FILTER (WHERE d.reading_kind = ${KIND.power} AND r.status = ${ST.on})::int AS heater_on
      FROM iot_readings r JOIN iot_devices d ON d.id = r.device_id
      WHERE r.recorded_at >= ${r.from} AND r.recorded_at <= ${r.to}
      GROUP BY d.location`);
    return rows.map((r) => ({
      location: String(r.location), tempReadings: Number(r.temp_readings), warningReadings: Number(r.warning_readings), peakTempC: num(r.peak),
      heaterReadings: Number(r.heater_readings), heaterOn: Number(r.heater_on),
    }));
  }

  async events(r: RangeSpec, limit: number): Promise<{ rows: EventRow[]; total: number }> {
    const where = { status: { in: ATTENTION_STATUSES }, recordedAt: { gte: r.from, lte: r.to } };
    // Los más recientes primero y con tope: en un rango de meses hay decenas de miles; los hallazgos se calculan con los últimos `limit`.
    const [rows, total] = await Promise.all([
      this.prisma.iotReading.findMany({
        where, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], take: limit,
        select: { recordedAt: true, status: true, value: true, unit: true, note: true, device: { select: { name: true, location: true } } },
      }),
      this.prisma.iotReading.count({ where }),
    ]);
    return { total, rows: rows.map((e) => ({ recordedAt: e.recordedAt, deviceName: e.device.name, location: e.device.location, status: e.status, value: e.value, unit: e.unit, note: e.note })) };
  }

  async statusCounts(r: RangeSpec): Promise<StatusCount[]> {
    const rows = await this.prisma.iotReading.groupBy({ by: ['status'], where: { recordedAt: { gte: r.from, lte: r.to } }, _count: { _all: true } });
    return rows.map((x) => ({ status: x.status, count: x._count._all }));
  }

  async tempWarningC(): Promise<number | null> {
    const a = await this.prisma.iotReading.aggregate({ _min: { value: true }, where: { status: ST.warning, device: { readingKind: KIND.temp } } });
    return a._min.value;
  }

  async window(): Promise<{ from: Date; to: Date } | null> {
    const a = await this.prisma.iotReading.aggregate({ _min: { recordedAt: true }, _max: { recordedAt: true } });
    return a._min.recordedAt && a._max.recordedAt ? { from: a._min.recordedAt, to: a._max.recordedAt } : null;
  }
}
