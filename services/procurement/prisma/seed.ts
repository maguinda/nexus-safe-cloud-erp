import { PrismaClient } from '@prisma/client';

// Datos de DEMOSTRACIÓN inventados. Ids fijos para que el seed sea idempotente.
const suppliers = [
  { id: '22222222-2222-4222-8222-222222222201', name: 'Redes del Norte (example)', kind: 'fixed', terms: 'Pago a 30 días; entrega en 5 días hábiles' },
  { id: '22222222-2222-4222-8222-222222222202', name: 'Climatización Andina (example)', kind: 'tender', terms: 'Por licitación; garantía de 12 meses' },
];
const items = [
  { id: '33333333-3333-4333-8333-333333333301', name: 'Sensor de temperatura TH-10', kind: 'spare', forKinds: ['TEMP', 'HUMIDITY'], onHand: 8 },
  { id: '33333333-3333-4333-8333-333333333302', name: 'Fuente de poder 12 V', kind: 'spare', forKinds: ['POWER'], onHand: 3 },
  { id: '33333333-3333-4333-8333-333333333303', name: 'Switch de acceso 24 puertos', kind: 'equipment', forKinds: [], onHand: 2 },
];

// Qué vende cada proveedor (precio de referencia y plazo en días): el fijo vende los tres; el de licitación, el sensor y la fuente.
const catalog = [
  { supplierId: '22222222-2222-4222-8222-222222222201', itemId: '33333333-3333-4333-8333-333333333303', refPriceCop: 2_400_000, leadDays: 5 },
  { supplierId: '22222222-2222-4222-8222-222222222201', itemId: '33333333-3333-4333-8333-333333333301', refPriceCop: 120_000, leadDays: 5 },
  { supplierId: '22222222-2222-4222-8222-222222222201', itemId: '33333333-3333-4333-8333-333333333302', refPriceCop: 180_000, leadDays: 5 },
  { supplierId: '22222222-2222-4222-8222-222222222202', itemId: '33333333-3333-4333-8333-333333333301', refPriceCop: 95_000, leadDays: 10 },
  { supplierId: '22222222-2222-4222-8222-222222222202', itemId: '33333333-3333-4333-8333-333333333302', refPriceCop: 165_000, leadDays: 12 },
];

async function main() {
  const prisma = new PrismaClient();
  for (const s of suppliers) await prisma.supplier.upsert({ where: { id: s.id }, update: {}, create: s });
  for (const i of items) await prisma.item.upsert({ where: { id: i.id }, update: {}, create: i });
  for (const c of catalog) await prisma.supplierItem.upsert({ where: { supplierId_itemId: { supplierId: c.supplierId, itemId: c.itemId } }, update: {}, create: c });
  await prisma.supplier.updateMany({ where: { id: suppliers[1].id, tenderRef: null }, data: { tenderRef: 'LIC-2026-014', validUntil: new Date('2027-06-30T00:00:00Z') } });
  console.log('Seeded demo suppliers and items');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
