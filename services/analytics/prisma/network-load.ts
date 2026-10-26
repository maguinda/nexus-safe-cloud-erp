import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

// Carga el inventario de red de la carpeta PROYECTO_NEXUS (convertido por prisma/data/convert-network.py). Es idempotente: los ids vienen de la fuente
// (y el monitoreo se identifica por el nombre del equipo), así que cargar dos veces, o encima de una carga a medias, no duplica ni cambia nada.
const read = <T>(name: string): T => JSON.parse(readFileSync(join(__dirname, 'data', name), 'utf8')) as T;

export async function loadNetwork(prisma: PrismaClient): Promise<{ devices: number; links: number; monitoring: number }> {
  const devices = read<{ id: number; name: string; ptType: string; model: string; category: string; role: string; criticality: string; serial: string; ips: string | null; gateways: string | null }[]>('network-devices.json');
  const links = read<{ id: number; originName: string; originPort: string; destinationName: string; destinationPort: string; linkType: string; cableType: string | null; functional: boolean | null; length: number | null; criticality: string }[]>('network-links.json');
  const monitoring = read<{ deviceName: string; syslog: boolean; snmp: boolean; ntp: boolean; netflow: boolean; signals: string[] }[]>('network-monitoring.json');
  await prisma.$transaction(async (tx) => {
    // En este orden: los enlaces y el monitoreo apuntan a dispositivos por nombre (clave foránea).
    await tx.networkDevice.createMany({ data: devices, skipDuplicates: true });
    await tx.networkLink.createMany({ data: links, skipDuplicates: true });
    await tx.networkMonitoring.createMany({ data: monitoring, skipDuplicates: true });
  }, { timeout: 60_000 });
  return { devices: await prisma.networkDevice.count(), links: await prisma.networkLink.count(), monitoring: await prisma.networkMonitoring.count() };
}
