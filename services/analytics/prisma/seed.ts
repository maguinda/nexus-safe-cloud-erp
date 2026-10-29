import { PrismaClient } from '@prisma/client';
import { loadIot } from './iot-load';
import { loadNetwork } from './network-load';

// Datos de DEMOSTRACIÓN: los dos hitos que ya vienen aprobados y facturados en los seeds de projects y billing (m1 y m4).
// Como esos seeds se cargan directo en cada base (sin eventos), Analytics necesita su propio punto de partida.
const seeded = [
  { milestoneId: 'm1', projectId: 'p1', projectName: 'Branch network upgrade', milestoneName: 'Site survey', amountCop: 12_000_000, invoiceNumber: 'INV-0101', taxCop: 2_280_000, totalCop: 14_280_000, at: new Date('2026-10-12T15:00:00Z') },
  { milestoneId: 'm4', projectId: 'p2', projectName: 'Retail POS integration', milestoneName: 'API contract', amountCop: 9_800_000, invoiceNumber: 'INV-0102', taxCop: 1_862_000, totalCop: 11_662_000, at: new Date('2026-10-15T15:00:00Z') },
];

// Los cuatro hitos que el seed de projects deja PENDIENTES (m2, m3, m5 y m6): como ese seed tampoco publica eventos, Analytics los conoce desde aquí.
const pending = [
  { milestoneId: 'm2', projectId: 'p1', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', amountCop: 18_500_000 },
  { milestoneId: 'm3', projectId: 'p1', projectName: 'Branch network upgrade', milestoneName: 'Cutover', amountCop: 25_000_000 },
  { milestoneId: 'm5', projectId: 'p2', projectName: 'Retail POS integration', milestoneName: 'Pilot in 3 stores', amountCop: 14_200_000 },
  { milestoneId: 'm6', projectId: 'p3', projectName: 'SME cloud migration', milestoneName: 'Inventory of workloads', amountCop: 7_500_000 },
];

async function main() {
  const prisma = new PrismaClient();
  for (const f of seeded) {
    const data = {
      projectId: f.projectId, projectName: f.projectName, milestoneName: f.milestoneName, amountCop: f.amountCop, approvedBy: 'laura.rios@nexus.example', approvedAt: f.at,
      invoiceNumber: f.invoiceNumber, invoiceStatus: 'issued' as const, taxCop: f.taxCop, totalCop: f.totalCop, draftedAt: f.at, issuedAt: f.at,
    };
    await prisma.milestoneFact.upsert({ where: { milestoneId: f.milestoneId }, update: {}, create: { milestoneId: f.milestoneId, ...data } });
  }
  for (const f of pending) {
    await prisma.milestoneFact.upsert({ where: { milestoneId: f.milestoneId }, update: {}, create: { ...f, createdAt: new Date('2026-10-01T12:00:00Z') } });
  }
  console.log('Seeded demo read model');
  const iot = await loadIot(prisma);
  console.log(`Loaded IoT telemetry: ${iot.devices} devices, ${iot.readings} readings`);
  const net = await loadNetwork(prisma);
  console.log(`Loaded network inventory: ${net.devices} devices, ${net.links} links, ${net.monitoring} monitored`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
