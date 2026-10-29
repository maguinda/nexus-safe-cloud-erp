import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

// Carga los datos de la carpeta PROYECTO_NEXUS (convertidos por prisma/data/convert-iot.py). Es idempotente: el id de cada
// lectura viene de la fuente, así que cargar dos veces, o cargar encima de una carga a medias, no duplica ni cambia nada.
const read = <T>(name: string): T => JSON.parse(readFileSync(join(__dirname, 'data', name), 'utf8')) as T;
const BATCH = 1000;

export async function loadIot(prisma: PrismaClient): Promise<{ devices: number; readings: number }> {
  const devices = read<{ id: string; name: string; kind: string; location: string; vlan: string; ipAddress: string; macAddress: string; connection: string; readingKind: string; unit: string }[]>('iot-devices.json');
  const readings = read<{ id: number; deviceId: string; recordedAt: string; status: string; value: number; unit: string; note: string | null }[]>('iot-readings.json');
  await prisma.$transaction(async (tx) => {
    await tx.iotDevice.createMany({ data: devices, skipDuplicates: true });
    for (let i = 0; i < readings.length; i += BATCH) {
      await tx.iotReading.createMany({ data: readings.slice(i, i + BATCH).map((r) => ({ ...r, recordedAt: new Date(r.recordedAt) })), skipDuplicates: true });
    }
  }, { timeout: 60_000 });
  // Los ids de las lecturas se escriben a mano (vienen de la fuente) y eso NO adelanta la secuencia de identidad (migración 0004). En una base
  // nueva la migración corre con la tabla vacía (secuencia en 1) y el seed se carga después: sin esto, la primera lectura que llegue por la API
  // de ingesta recibiría el id 1, chocaría con la del seed y se perdería. Nunca retrocede: parte del id MÁS ALTO que haya, también de las nuevas.
  await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"iot_readings"', 'id'), (SELECT COALESCE(MAX("id"), 0) + 1 FROM "iot_readings"), false)`);
  // Estado de alerta inicial desde la última lectura, SOLO de los dispositivos que aún no tienen estado (nunca pisa el de uno que ya recibe lecturas en vivo):
  // sin esto, la primera lectura de ingesta de un dispositivo que el seed dejó en alerta avisaría como si acabara de empeorar.
  await prisma.$executeRawUnsafe(`UPDATE "iot_devices" d SET "alert_state" = CASE l."status" WHEN 'ALERT' THEN 'alert' WHEN 'WARNING' THEN 'warning' ELSE 'normal' END, "alert_state_at" = l."recorded_at"
    FROM (SELECT DISTINCT ON ("device_id") "device_id", "status", "recorded_at" FROM "iot_readings" ORDER BY "device_id", "recorded_at" DESC) l
    WHERE l."device_id" = d."id" AND d."alert_state_at" IS NULL`);
  return { devices: await prisma.iotDevice.count(), readings: await prisma.iotReading.count() };
}
