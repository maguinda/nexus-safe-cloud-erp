import { PrismaClient } from '@prisma/client';

// Datos de DEMOSTRACIÓN inventados. Ids fijos para que el seed sea idempotente. Fechas relativas a hoy (UTC).
// Costo diario de DEMOSTRACIÓN (inventado) en pesos; en producción lo escribe gerencia.
const DEMO_COST = [450_000, 520_000, 600_000, 380_000, 360_000, 480_000];
const engineers = [
  { id: '11111111-1111-4111-8111-111111111101', name: 'Ana Torres', role: 'Network engineer', skills: ['Cisco', 'SD-WAN', 'Terraform'], certifications: ['CCNP'] },
  { id: '11111111-1111-4111-8111-111111111102', name: 'Julián Pardo', role: 'Cloud engineer', skills: ['AWS', 'Kubernetes', 'Terraform'], certifications: ['AWS Solutions Architect'] },
  { id: '11111111-1111-4111-8111-111111111103', name: 'Marcela Díaz', role: 'Security engineer', skills: ['Zero Trust', 'SIEM', 'Pentesting'], certifications: ['CISSP', 'CEH'] },
  { id: '11111111-1111-4111-8111-111111111104', name: 'Camilo Rojas', role: 'Backend developer', skills: ['TypeScript', 'NestJS', 'PostgreSQL'], certifications: [] },
  { id: '11111111-1111-4111-8111-111111111105', name: 'Paula Gómez', role: 'Frontend developer', skills: ['React', 'TypeScript', 'Accessibility'], certifications: [] },
  { id: '11111111-1111-4111-8111-111111111106', name: 'Sergio Mejía', role: 'DevOps engineer', skills: ['GitHub Actions', 'Argo CD', 'Helm'], certifications: ['CKA'] },
];
const day = (offset: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d; };
// engineer index, project, percent, start offset, end offset (días desde hoy)
const allocations: [number, string, number, number, number][] = [
  [0, 'Branch network upgrade', 60, -10, 40], [0, 'Retail POS integration', 30, 5, 30],
  [1, 'SME cloud migration', 80, -5, 60],
  [2, 'Branch network upgrade', 40, -3, 25],
  [3, 'Retail POS integration', 50, -20, 15], [3, 'SME cloud migration', 50, -2, 20],
  [5, 'SME cloud migration', 25, 0, 45],
];

async function main() {
  const prisma = new PrismaClient();
  for (const [i, e] of engineers.entries()) await prisma.engineer.upsert({ where: { id: e.id }, update: {}, create: { ...e, dailyCostCop: DEMO_COST[i] } });
  if ((await prisma.allocation.count()) === 0) {
    for (const [i, projectName, percent, s, e] of allocations) await prisma.allocation.create({ data: { engineerId: engineers[i].id, projectName, percent, startDate: day(s), endDate: day(e) } });
  }
  console.log('Seeded demo engineers and allocations');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
