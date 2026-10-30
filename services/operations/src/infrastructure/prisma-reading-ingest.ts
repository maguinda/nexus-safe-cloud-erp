import { Prisma, PrismaClient } from '@prisma/client';
import { thresholdBreached, THRESHOLD_BREACHED_ROUTING_KEY } from '../domain/events';
import type { NewReading } from '../domain/ingest';
import type { IngestContext, ReadingIngest } from '../domain/ports';
import { Severity } from '../domain/telemetry';
import { decideTransitions, DeviceAlertState, InsertedReading } from '../domain/threshold';

const TX = { timeout: 20_000, maxWait: 10_000 };

export class PrismaReadingIngest implements ReadingIngest {
  constructor(private readonly prisma: PrismaClient) {}

  async deviceUnits(): Promise<Map<string, string>> {
    const rows = await this.prisma.iotDevice.findMany({ select: { id: true, unit: true } });
    return new Map(rows.map((r) => [r.id, r.unit]));
  }

  /**
   * Guarda el lote Y decide los avisos, todo en UNA transacción.
   * 1) Se bloquean los dispositivos del lote EN ORDEN de id (`FOR UPDATE`) ANTES de insertar: insertar una lectura toma un candado débil sobre su
   *    dispositivo (la llave foránea) y pedir después el fuerte desde dos lotes a la vez se bloquearía en círculo.
   * 2) Se insertan las lecturas y se obtienen SOLO las que entraron de verdad (las repetidas no cuentan ni avisan).
   * 3) El estado de cada dispositivo se lee DENTRO del bloqueo y se compara en `decideTransitions`; si empeoró, el aviso (outbox) y el nuevo
   *    estado se escriben en la misma transacción. Si algo falla, no queda ni la lectura ni el aviso.
   */
  async insertReadings(rows: NewReading[], ctx: IngestContext): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const ids = [...new Set(rows.map((r) => r.deviceId))].sort();
      const devices = await tx.$queryRaw<{ id: string; name: string; location: string; reading_kind: string; alert_state: string; alert_state_at: Date | null }[]>`
        SELECT id, name, location, reading_kind, alert_state, alert_state_at FROM iot_devices WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
      // El destino del conflicto es EXPLÍCITO: solo lo repetido (mismo dispositivo e instante) se ignora. Un «ON CONFLICT DO NOTHING» sin destino
      // (lo que hace `createMany` con `skipDuplicates`) también callaría una colisión de la clave primaria y la lectura se perdería sin aviso.
      // Un único parámetro JSON con todo el lote: una sola ida a la base. Los instantes llegan en UTC y se guardan como los guarda Prisma (sin zona).
      const batch = JSON.stringify(rows.map((r) => ({ deviceId: r.deviceId, recordedAt: r.recordedAt.toISOString(), status: r.status, value: r.value, unit: r.unit, note: r.note })));
      const inserted = await tx.$queryRaw<{ device_id: string; recorded_at: Date; status: string; value: number; unit: string }[]>`
        INSERT INTO "iot_readings" ("device_id", "recorded_at", "status", "value", "unit", "note")
        SELECT x."deviceId", x."recordedAt" AT TIME ZONE 'UTC', x."status", x."value", x."unit", x."note"
        FROM jsonb_to_recordset(${batch}::jsonb) AS x("deviceId" text, "recordedAt" timestamptz, "status" text, "value" double precision, "unit" text, "note" text)
        ON CONFLICT ("device_id", "recorded_at") DO NOTHING
        RETURNING "device_id", "recorded_at", "status", "value", "unit"`;
      if (inserted.length === 0) return 0;

      const byId = new Map(devices.map((d) => [d.id, d]));
      const states: DeviceAlertState[] = devices.map((d) => ({ id: d.id, state: d.alert_state as Severity, stateAt: d.alert_state_at }));
      const fresh: InsertedReading[] = inserted.map((r) => ({ deviceId: r.device_id, recordedAt: r.recorded_at, status: r.status, value: r.value, unit: r.unit }));
      for (const t of decideTransitions(states, fresh, ctx.now)) {
        // El instante va como texto ISO y se pasa a UTC explícito: la columna no lleva zona y no debe depender de la zona de la sesión.
        await tx.$executeRaw`UPDATE iot_devices SET alert_state = ${t.newState}, alert_state_at = ${t.newStateAt.toISOString()}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${t.deviceId}`;
        if (!t.breach) continue;
        const d = byId.get(t.deviceId)!;
        const event = thresholdBreached({ id: d.id, name: d.name, location: d.location, readingKind: d.reading_kind }, t.breach, ctx.correlationId, ctx.now);
        await tx.outboxEvent.create({
          data: {
            id: event.eventId, aggregateId: `${d.id}:${t.breach.recordedAt.toISOString()}`, type: event.type, routingKey: THRESHOLD_BREACHED_ROUTING_KEY,
            payload: event as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return inserted.length;
    }, TX);
  }
}
