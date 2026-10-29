import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

// Se lee con fs (como los JSON de telemetría de analytics): no obliga a cambiar el tsconfig del servicio.
const customers: { name: string; key: string; nit: string; dv: number; email: string; address: string; city: string }[] = JSON.parse(readFileSync(join(__dirname, 'demo-customers.json'), 'utf8'));

// Facturas de DEMOSTRACIÓN que corresponden a los hitos ya aprobados del seed de projects (m1 y m4).
// Clientes de DEMOSTRACIÓN (inventados: NIT ficticios con su dígito de verificación) para poder generar el documento electrónico de prueba. La clave es el nombre normalizado.
// Los hitos de la demo nacen de projects con estos mismos nombres de cliente; el cliente de cada factura sembrada va aquí porque ese seed tampoco publica eventos.
const clientOf: Record<string, string> = { 'INV-0101': 'Banco Andino (example)', 'INV-0102': 'Retail Norte (example)' };
const seeded = [
  { number: 'INV-0101', milestoneId: 'm1', projectName: 'Branch network upgrade', milestoneName: 'Site survey', amountCop: 12_000_000, taxCop: 2_280_000, totalCop: 14_280_000, createdAt: new Date('2026-10-12T15:00:00Z') },
  { number: 'INV-0102', milestoneId: 'm4', projectName: 'Retail POS integration', milestoneName: 'API contract', amountCop: 9_800_000, taxCop: 1_862_000, totalCop: 11_662_000, createdAt: new Date('2026-10-15T15:00:00Z') },
];

async function main() {
  const prisma = new PrismaClient();
  for (const i of seeded) {
    await prisma.invoice.upsert({
      where: { number: i.number }, update: {},
      create: { ...i, status: 'issued', issuedAt: i.createdAt, issuedBy: 'andres.mora@nexus.example', dueDate: new Date(i.createdAt.getTime() + 30 * 86_400_000) }, // 30 días en UTC (misma regla que domain/due-date.ts)
    });
  }
  for (const [number, clientName] of Object.entries(clientOf)) await prisma.invoice.updateMany({ where: { number, clientName: null }, data: { clientName } });
  for (const c of customers) {
    await prisma.customer.upsert({ where: { key: c.key }, update: {}, create: c });
  }
  console.log('Seeded demo invoices and fiscal data of the demo clients');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
