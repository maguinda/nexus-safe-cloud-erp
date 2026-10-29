import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { resetState } from './helpers';

// Aquí SÍ se enciende el programador (antes de arrancar la app): revisa cada segundo.
process.env.OVERDUE_ENABLED = 'true';
process.env.OVERDUE_CHECK_MS = '1000';
process.env.CONSUMER_ENABLED = 'false';
process.env.RELAY_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

describe('overdue scheduler inside the running service (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const events = () => prisma.outboxEvent.count({ where: { type: 'InvoiceOverdue' } });
  const waitUntil = async (cond: () => Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };

  beforeAll(async () => { await resetState(prisma); const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  afterAll(async () => { await app.close(); await resetState(prisma); await prisma.$disconnect(); });

  it('the running service notices by itself an invoice that is overdue (no one calls anything), once, and not the ones that are not', async () => {
    await prisma.invoice.createMany({ data: [
      { number: 'INV-0501', milestoneId: 's1', projectName: 'P', milestoneName: 'M1', amountCop: 1000, taxCop: 190, totalCop: 1190, status: 'issued', issuedAt: new Date('2026-09-01T00:00:00Z'), issuedBy: 'a@x.co', dueDate: new Date('2026-10-01T00:00:00Z'), clientName: 'C' },
      { number: 'INV-0502', milestoneId: 's2', projectName: 'P', milestoneName: 'M2', amountCop: 1000, taxCop: 190, totalCop: 1190, status: 'issued', issuedAt: new Date('2026-10-28T00:00:00Z'), issuedBy: 'a@x.co', dueDate: new Date('2099-01-01T00:00:00Z'), clientName: 'C' },
    ] });
    const has = async (n: string) => (await prisma.outboxEvent.count({ where: { type: 'InvoiceOverdue', aggregateId: n } })) === 1;
    expect(await waitUntil(() => has('INV-0501'))).toBe(true);
    await new Promise((r) => setTimeout(r, 2500)); // varias pasadas más: no se repite
    const all = (await prisma.outboxEvent.findMany({ where: { type: 'InvoiceOverdue' } })).map((e) => e.aggregateId);
    expect(all).toContain('INV-0501'); expect(all).not.toContain('INV-0502');
    expect(new Set(all).size).toBe(all.length); // ninguna factura dos veces
  });
});
