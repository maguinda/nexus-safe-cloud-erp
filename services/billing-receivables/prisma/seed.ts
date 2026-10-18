import { PrismaClient } from '@prisma/client';

// Facturas de DEMOSTRACIÓN que corresponden a los hitos ya aprobados del seed de projects (m1 y m4).
const seeded = [
  { number: 'INV-0101', milestoneId: 'm1', projectName: 'Branch network upgrade', milestoneName: 'Site survey', amountCop: 12_000_000, taxCop: 2_280_000, totalCop: 14_280_000, createdAt: new Date('2026-10-12T15:00:00Z') },
  { number: 'INV-0102', milestoneId: 'm4', projectName: 'Retail POS integration', milestoneName: 'API contract', amountCop: 9_800_000, taxCop: 1_862_000, totalCop: 11_662_000, createdAt: new Date('2026-10-15T15:00:00Z') },
];

async function main() {
  const prisma = new PrismaClient();
  for (const i of seeded) {
    await prisma.invoice.upsert({
      where: { number: i.number }, update: {},
      create: { ...i, status: 'issued', issuedAt: i.createdAt, issuedBy: 'andres.mora@nexus.example' },
    });
  }
  console.log('Seeded demo invoices');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
