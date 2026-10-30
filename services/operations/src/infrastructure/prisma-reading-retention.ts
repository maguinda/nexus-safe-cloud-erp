import { PrismaClient } from '@prisma/client';
import type { ReadingRetention } from '../domain/ports';

export class PrismaReadingRetention implements ReadingRetention {
  constructor(private readonly prisma: PrismaClient) {}

  /** Borra hasta `limit` lecturas anteriores a `cutoff` que NO sean la última de su dispositivo (existe otra más nueva del mismo dispositivo). */
  async deleteOlderThan(cutoff: Date, limit: number): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM iot_readings WHERE id IN (
        SELECT r.id FROM iot_readings r
        WHERE r.recorded_at < ${cutoff.toISOString()}::timestamptz AT TIME ZONE 'UTC'
          AND EXISTS (SELECT 1 FROM iot_readings n WHERE n.device_id = r.device_id AND n.recorded_at > r.recorded_at)
        ORDER BY r.recorded_at LIMIT ${limit})`;
  }
}
