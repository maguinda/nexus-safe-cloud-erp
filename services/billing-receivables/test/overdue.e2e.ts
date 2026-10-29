import { PrismaClient } from '@prisma/client';
import { DetectOverdueInvoicesUseCase } from '../src/application/detect-overdue.use-case';
import { PrismaOverdueUnitOfWork } from '../src/infrastructure/prisma-units-of-work';
import { resetState } from './helpers';

describe('overdue invoices detector (e2e, real PostgreSQL)', () => {
  const prisma = new PrismaClient();
  // Antes del 11-nov: las dos facturas sembradas de la demo vencen el 11 y el 14 de noviembre y no deben contar como vencidas en estas pruebas.
  const NOW = new Date('2026-11-10T12:00:00.000Z');
  let seq = 400;
  const issued = async (due: string | null, over: Record<string, unknown> = {}) => {
    const n = seq++;
    const number = `INV-${String(n).padStart(4, '0')}`;
    await prisma.invoice.create({ data: { number, milestoneId: `o${n}`, projectName: 'Branch network upgrade', milestoneName: `Milestone ${n}`, amountCop: 1_000_000, taxCop: 190_000, totalCop: 1_190_000, status: 'issued', issuedAt: new Date('2026-09-01T10:00:00Z'), issuedBy: 'andres.mora@nexus.example', dueDate: due === null ? null : new Date(due), clientName: 'Banco Andino (example)', ...over } });
    return number;
  };
  const detector = (now = NOW) => new DetectOverdueInvoicesUseCase(new PrismaOverdueUnitOfWork(prisma), () => now);
  const overdueEvents = () => prisma.outboxEvent.findMany({ where: { type: 'OverdueDetected' }, orderBy: { aggregateId: 'asc' } });
  const clean = async () => { await resetState(prisma); };

  beforeEach(clean);
  afterAll(async () => { await clean(); await prisma.$disconnect(); });

  it('writes exactly one OverdueDetected per overdue invoice (routing key, payload, unpublished) and none for the ones that are not overdue', async () => {
    const yesterday = await issued('2026-11-09T15:00:00Z'); const old = await issued('2026-10-01T10:00:00Z');
    await issued('2026-11-10T20:00:00Z'); await issued('2026-12-01T00:00:00Z'); await issued(null, { status: 'draft', issuedAt: null, issuedBy: null });
    expect(await detector().execute()).toEqual({ detected: 2 });
    const events = await overdueEvents();
    expect(events.map((e) => e.aggregateId).sort()).toEqual([yesterday, old].sort());
    for (const e of events) expect(e).toMatchObject({ type: 'OverdueDetected', routingKey: 'billing.invoice.overdue', publishedAt: null });
    const payload = events.find((e) => e.aggregateId === yesterday)!.payload as any;
    expect(payload).toMatchObject({ type: 'OverdueDetected', occurredAt: NOW.toISOString(), data: { invoiceNumber: yesterday, clientName: 'Banco Andino (example)', dueDate: '2026-11-09T15:00:00.000Z', daysOverdue: 1, amountCop: 1_000_000, taxCop: 190_000, totalCop: 1_190_000 } });
    expect(payload.correlationId).toMatch(/^overdue-20261110-[0-9a-f]{8}$/);
    expect(JSON.stringify(payload)).not.toMatch(/@/); // sin correos ni datos personales
  });
  it('it is once per invoice: running again, even much later, does not repeat it (the days are told once, when it became overdue)', async () => {
    const n = await issued('2026-11-09T15:00:00Z');
    expect(await detector().execute()).toEqual({ detected: 1 });
    expect(await detector().execute()).toEqual({ detected: 0 });
    await detector(new Date('2027-03-01T00:00:00Z')).execute(); // meses después: las facturas sembradas de la demo ya habrán vencido, pero la de esta prueba NO se repite
    expect((await overdueEvents()).filter((e) => e.aggregateId === n)).toHaveLength(1);
  });
  it('an invoice becomes overdue the day AFTER its due day: nothing on the due day, one event the next day', async () => {
    const n = await issued('2026-11-09T15:00:00Z');
    expect(await detector(new Date('2026-11-09T23:59:59.999Z')).execute()).toEqual({ detected: 0 });
    expect(await detector(new Date('2026-11-10T00:00:00.000Z')).execute()).toEqual({ detected: 1 });
    expect(((await overdueEvents())[0].payload as any).data).toMatchObject({ invoiceNumber: n, daysOverdue: 1 });
  });
  it('an invoice issued after the first pass and overdue later is detected in its own pass', async () => {
    await issued('2026-11-01T10:00:00Z');
    await detector().execute();
    await issued('2026-11-02T10:00:00Z');
    expect(await detector().execute()).toEqual({ detected: 1 });
    expect(await overdueEvents()).toHaveLength(2);
  });
  it('CONCURRENCY (30 rounds): 5 detectors at once over 8 overdue invoices write exactly 8 events, each invoice once, and none of them fails', async () => {
    for (let round = 0; round < 30; round++) {
      await clean();
      const numbers = await Promise.all(Array.from({ length: 8 }, (_, i) => issued(`2026-11-${String(1 + i).padStart(2, '0')}T10:00:00Z`)));
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => detector().execute()));
      expect({ round, rejected: results.filter((r) => r.status === 'rejected').length }).toEqual({ round, rejected: 0 });
      const detected = results.reduce((n, r) => n + (r.status === 'fulfilled' ? r.value.detected : 0), 0);
      expect({ round, detected }).toEqual({ round, detected: 8 });
      expect((await overdueEvents()).map((e) => e.aggregateId).sort()).toEqual([...numbers].sort());
    }
  });
  it('the database refuses a second OverdueDetected for the same invoice even if the code were wrong', async () => {
    const n = await issued('2026-11-01T10:00:00Z');
    await detector().execute();
    await expect(prisma.outboxEvent.create({ data: { id: '11111111-1111-4111-8111-111111111111', aggregateId: n, type: 'OverdueDetected', routingKey: 'billing.invoice.overdue', payload: {} } })).rejects.toThrow();
  });
  it('a big backlog is cleared in batches: 250 overdue invoices need two passes and end with exactly 250 events', async () => {
    await prisma.$executeRaw`
      INSERT INTO invoices (id, number, milestone_id, project_name, milestone_name, amount_cop, tax_cop, total_cop, status, issued_at, issued_by, due_date, client_name)
      SELECT gen_random_uuid(), 'INV-' || (10000 + g), 'bulk' || g, 'P', 'M' || g, 1000, 190, 1190, 'issued', '2026-10-01T00:00:00Z', 'a@x.co', '2026-11-01T00:00:00Z', 'Cliente' FROM generate_series(1, 250) AS g`;
    const first = await detector().execute(); const second = await detector().execute();
    expect([first.detected, second.detected]).toEqual([200, 50]);
    expect(await overdueEvents()).toHaveLength(250);
    expect(await detector().execute()).toEqual({ detected: 0 });
  });
  it('writing the SAME invoice\'s overdue event a second time answers false and neither fails nor duplicates (what a detector that arrives late meets)', async () => {
    const n = await issued('2026-11-01T10:00:00Z');
    const event = (id: string) => ({ eventId: id, type: 'OverdueDetected' as const, occurredAt: NOW.toISOString(), correlationId: 'overdue-20261110-aaaaaaaa', data: { invoiceNumber: n, milestoneId: 'x', projectName: 'P', milestoneName: 'M', amountCop: 1, taxCop: 0, totalCop: 1, clientName: null, dueDate: '2026-11-01T10:00:00.000Z', daysOverdue: 9 } });
    const uow = new PrismaOverdueUnitOfWork(prisma);
    const first = await uow.run((tx) => tx.addToOutbox(event('22222222-2222-4222-8222-222222222222')));
    const second = await uow.run((tx) => tx.addToOutbox(event('33333333-3333-4333-8333-333333333333')));
    expect([first, second]).toEqual([true, false]);
    expect((await overdueEvents()).filter((e) => e.aggregateId === n)).toHaveLength(1);
  });
});
