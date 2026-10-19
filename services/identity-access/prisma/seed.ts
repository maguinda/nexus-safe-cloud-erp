import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';

// Usuarios de DEMOSTRACIÓN (datos inventados). La contraseña viene de DEMO_PASSWORD.
const demo: { email: string; name: string; role: Role }[] = [
  { email: 'laura.rios@nexus.example', name: 'Laura Ríos', role: 'project_lead' },
  { email: 'andres.mora@nexus.example', name: 'Andrés Mora', role: 'billing_analyst' },
  { email: 'camila.soto@nexus.example', name: 'Camila Soto', role: 'sales' },
  { email: 'diana.vega@nexus.example', name: 'Diana Vega', role: 'manager' },
];

async function main() {
  const pw = process.env.DEMO_PASSWORD;
  if (!pw || pw.length < 8) throw new Error('Set DEMO_PASSWORD (min 8 chars) in .env');
  const prisma = new PrismaClient();
  const passwordHash = await hash(pw, 10);
  for (const u of demo) {
    await prisma.user.upsert({ where: { email: u.email }, update: { name: u.name, role: u.role, passwordHash }, create: { ...u, passwordHash } });
  }
  console.log(`Seeded ${demo.length} demo users`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
