import { PrismaClient } from '@prisma/client';
import { loadIot } from './iot-load';
import { loadNetwork } from './network-load';

// Datos de DEMOSTRACIÓN de la carpeta PROYECTO_NEXUS de la docente. Idempotente: cargar dos veces no duplica nada.
async function main() {
  const prisma = new PrismaClient();
  const iot = await loadIot(prisma);
  console.log(`Loaded IoT telemetry: ${iot.devices} devices, ${iot.readings} readings`);
  const net = await loadNetwork(prisma);
  console.log(`Loaded network inventory: ${net.devices} devices, ${net.links} links, ${net.monitoring} monitored`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
