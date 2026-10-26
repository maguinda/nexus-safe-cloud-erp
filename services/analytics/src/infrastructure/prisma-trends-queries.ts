import { Prisma, PrismaClient } from '@prisma/client';
import { TrendsQueries } from '../domain/ports';
import { ATTENTION_STATUSES } from '../domain/telemetry';
import { BucketRow, EventRow, LocationStat } from '../domain/trends';

// Qué lectura es de qué cosa lo dice la FUENTE (reading_kind del dispositivo) y los estados son los de la fuente: se pasan como parámetros, no se repiten en el SQL.
const KIND = { temp: 'TEMP', humidity: 'HUMIDITY', smoke: 'SMOKE', power: 'POWER', motion: 'DETECTION', door: 'STATE' };
const ST = { detected: 'DETECTED', unlocked: 'UNLOCKED', on: 'ON', warning: 'WARNING', alert: 'ALERT' };
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export class PrismaTrendsQueries implements TrendsQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async buckets(): Promise<BucketRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT d.location, date_bin('10 minutes', r.recorded_at, TIMESTAMP '2000-01-01') AS bucket,
        AVG(r.value) FILTER (WHERE d.reading_kind = ${KIND.temp}) AS avg_temp, MAX(r.value) FILTER (WHERE d.reading_kind = ${KIND.temp}) AS max_temp,
        AVG(r.value) FILTER (WHERE d.reading_kind = ${KIND.humidity}) AS avg_hum, MAX(r.value) FILTER (WHERE d.reading_kind = ${KIND.smoke}) AS max_smoke,
        100.0 * COUNT(*) FILTER (WHERE d.reading_kind = ${KIND.power} AND r.status = ${ST.on}) / NULLIF(COUNT(*) FILTER (WHERE d.reading_kind = ${KIND.power}), 0) AS heater_on,
        COUNT(*) FILTER (WHERE r.status = ${ST.detected})::int AS detections, COUNT(*) FILTER (WHERE r.status = ${ST.unlocked})::int AS unlocks,
        COUNT(*) FILTER (WHERE r.status = ${ST.warning})::int AS warnings, COUNT(*) FILTER (WHERE r.status = ${ST.alert})::int AS alerts
      FROM iot_readings r JOIN iot_devices d ON d.id = r.device_id GROUP BY d.location, bucket ORDER BY d.location, bucket`);
    return rows.map((r) => ({
      location: String(r.location), bucket: new Date(String(r.bucket).includes('Z') || r.bucket instanceof Date ? (r.bucket as Date) : `${r.bucket}Z`),
      avgTempC: num(r.avg_temp), maxTempC: num(r.max_temp), avgHumidityPct: num(r.avg_hum), maxSmokePpm: num(r.max_smoke), heaterOnPct: num(r.heater_on),
      detections: Number(r.detections), unlocks: Number(r.unlocks), warnings: Number(r.warnings), alerts: Number(r.alerts),
    }));
  }

  async perLocation(): Promise<LocationStat[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT d.location, COUNT(*)::int AS temp_readings, COUNT(*) FILTER (WHERE r.status = ${ST.warning})::int AS warning_readings, MAX(r.value) AS peak
      FROM iot_readings r JOIN iot_devices d ON d.id = r.device_id WHERE d.reading_kind = ${KIND.temp} GROUP BY d.location`);
    return rows.map((r) => ({ location: String(r.location), tempReadings: Number(r.temp_readings), warningReadings: Number(r.warning_readings), peakTempC: num(r.peak) }));
  }

  async events(): Promise<EventRow[]> {
    const rows = await this.prisma.iotReading.findMany({
      where: { status: { in: ATTENTION_STATUSES } }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      select: { recordedAt: true, status: true, value: true, unit: true, note: true, device: { select: { name: true, location: true } } },
    });
    return rows.map((r) => ({ recordedAt: r.recordedAt, deviceName: r.device.name, location: r.device.location, status: r.status, value: r.value, unit: r.unit, note: r.note }));
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
