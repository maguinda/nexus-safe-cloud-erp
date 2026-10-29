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
    // El destino del conflicto es EXPLÍCITO: solo lo repetido (mismo dispositivo e instante) se ignora. Un «ON CONFLICT DO NOTHING» sin destino
    // (lo que hace `createMany` con `skipDuplicates`) también callaría una colisión de la clave primaria y la lectura se perdería sin aviso.
    // Un único parámetro JSON con todo el lote: una sola ida a la base. Los instantes llegan en UTC y se guardan como los guarda Prisma (sin zona).
    const batch = JSON.stringify(rows.map((r) => ({ deviceId: r.deviceId, recordedAt: r.recordedAt.toISOString(), status: r.status, value: r.value, unit: r.unit, note: r.note })));
    return this.prisma.$executeRaw`
      INSERT INTO "iot_readings" ("device_id", "recorded_at", "status", "value", "unit", "note")
      SELECT x."deviceId", x."recordedAt" AT TIME ZONE 'UTC', x."status", x."value", x."unit", x."note"
      FROM jsonb_to_recordset(${batch}::jsonb) AS x("deviceId" text, "recordedAt" timestamptz, "status" text, "value" double precision, "unit" text, "note" text)
      ON CONFLICT ("device_id", "recorded_at") DO NOTHING`;
  }
}
