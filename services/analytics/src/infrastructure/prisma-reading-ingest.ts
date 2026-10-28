import { PrismaClient } from '@prisma/client';
import type { NewReading } from '../domain/ingest';
import type { ReadingIngest } from '../domain/ports';

export class PrismaReadingIngest implements ReadingIngest {
  constructor(private readonly prisma: PrismaClient) {}

  async deviceUnits(): Promise<Map<string, string>> {
    const rows = await this.prisma.iotDevice.findMany({ select: { id: true, unit: true } });
    return new Map(rows.map((r) => [r.id, r.unit]));
  }

  async insertReadings(rows: NewReading[]): Promise<number> {
    // INSERT ... ON CONFLICT DO NOTHING sobre la clave única (dispositivo, instante): lo repetido se ignora sin error y sin carreras.
    const r = await this.prisma.iotReading.createMany({ data: rows, skipDuplicates: true });
    return r.count;
  }
}
