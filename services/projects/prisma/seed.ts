import { MilestoneStatus, PrismaClient } from '@prisma/client';

// Datos de DEMOSTRACIÓN inventados (clientes ficticios). m1 y m4 ya están aprobados.
const projects = [
  { id: 'p1', name: 'Branch network upgrade', client: 'Banco Andino (example)', milestones: [
    { id: 'm1', name: 'Site survey', amountCop: 12_000_000, status: 'approved' },
    { id: 'm2', name: 'Link redundancy design', amountCop: 18_500_000, status: 'pending' },
    { id: 'm3', name: 'Cutover', amountCop: 25_000_000, status: 'pending' } ] },
  { id: 'p2', name: 'Retail POS integration', client: 'Retail Norte (example)', milestones: [
    { id: 'm4', name: 'API contract', amountCop: 9_800_000, status: 'approved' },
    { id: 'm5', name: 'Pilot in 3 stores', amountCop: 14_200_000, status: 'pending' } ] },
  { id: 'p3', name: 'SME cloud migration', client: 'Pyme Sur (example)', milestones: [
    { id: 'm6', name: 'Inventory of workloads', amountCop: 7_500_000, status: 'pending' } ] },
];

async function main() {
  const prisma = new PrismaClient();
  for (const p of projects) {
    await prisma.project.upsert({ where: { id: p.id }, update: { name: p.name, client: p.client }, create: { id: p.id, name: p.name, client: p.client } });
    for (const m of p.milestones) {
      const status = m.status as MilestoneStatus;
      const approved = status === 'approved' ? { approvedAt: new Date('2026-10-01T12:00:00Z'), approvedBy: 'laura.rios@nexus.example' } : { approvedAt: null, approvedBy: null };
      await prisma.milestone.upsert({ where: { id: m.id }, update: {}, create: { id: m.id, projectId: p.id, name: m.name, amountCop: m.amountCop, status, ...approved } });
    }
  }
  console.log('Seeded demo projects and milestones');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
