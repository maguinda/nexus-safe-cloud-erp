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
  return { devices: await prisma.iotDevice.count(), readings: await prisma.iotReading.count() };
}
