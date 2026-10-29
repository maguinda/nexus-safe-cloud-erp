import { BillingEvent } from '../domain/events';
import { Invoice } from '../domain/invoice';
import { OverdueScope, OverdueUnitOfWork } from '../domain/ports';
import { DetectOverdueInvoicesUseCase, OVERDUE_BATCH } from './detect-overdue.use-case';

const inv = (n: number, due: string, over: Partial<Invoice> = {}): Invoice => ({
  number: `INV-${String(n).padStart(4, '0')}`, milestoneId: `m${n}`, projectName: 'P', milestoneName: `M${n}`, amountCop: 1000, taxCop: 190, totalCop: 1190, status: 'issued',
  createdAt: new Date('2026-10-01T00:00:00Z'), issuedAt: new Date('2026-10-01T00:00:00Z'), issuedBy: 'a@x.co', sourceEventId: null, approvedBy: null, approvedAt: null, dueDate: new Date(due), clientName: 'Cliente', ...over,
});

/** Base en memoria: devuelve lo vencido que aún no tiene evento y respeta «una vez por factura». */
function fake(invoices: Invoice[], failAfter?: number) {
  const events: BillingEvent[] = [];
  let seen: string[] = [];
  let asked: { today: string; limit: number } | null = null;
  const uow: OverdueUnitOfWork = {
    async run(work) {
      const snapshot = [...events], snapSeen = [...seen];
      const tx: OverdueScope = {
        findNewlyOverdue: async (today, limit) => { asked = { today, limit }; return invoices.filter((i) => i.status === 'issued' && i.dueDate && i.dueDate.toISOString().slice(0, 10) < today && !seen.includes(i.number)).slice(0, limit); },
        addToOutbox: async (e) => {
          if (failAfter !== undefined && events.length >= failAfter) throw new Error('outbox down');
          if (seen.includes(e.data.invoiceNumber)) return false;
          seen.push(e.data.invoiceNumber); events.push(e); return true;
        },
      };
      try { return await work(tx); } catch (e) { events.length = 0; events.push(...snapshot); seen = snapSeen; throw e; }
    },
  };
  return { uow, events, get asked() { return asked; } };
}

describe('DetectOverdueInvoicesUseCase', () => {
  const NOW = new Date('2026-11-15T12:00:00Z');
  it('publishes one OverdueDetected per overdue invoice, with the days, the client name and the due date, and nothing for the ones that are not', async () => {
    const f = fake([inv(1, '2026-11-14T15:00:00Z'), inv(2, '2026-11-10T15:00:00Z'), inv(3, '2026-11-15T20:00:00Z'), inv(4, '2026-11-20T00:00:00Z'), inv(5, '2026-11-01T00:00:00Z', { status: 'draft', dueDate: null })]);
    const r = await new DetectOverdueInvoicesUseCase(f.uow, () => NOW).execute();
    expect(r).toEqual({ detected: 2 });
    expect(f.events.map((e) => [e.data.invoiceNumber, (e.data as any).daysOverdue])).toEqual([['INV-0001', 1], ['INV-0002', 5]]);
    expect(f.events[0]).toMatchObject({ type: 'OverdueDetected', occurredAt: NOW.toISOString(), data: { clientName: 'Cliente', dueDate: '2026-11-14T15:00:00.000Z', amountCop: 1000, taxCop: 190, totalCop: 1190 } });
  });
  it('asks for today in UTC with ONE clock reading and the batch size', async () => {
    const f = fake([]);
    await new DetectOverdueInvoicesUseCase(f.uow, () => new Date('2026-11-15T23:59:59.999Z')).execute();
    expect(f.asked).toEqual({ today: '2026-11-15', limit: OVERDUE_BATCH });
  });
  it('all the events of a pass share one correlation id with the format the bus accepts', async () => {
    const f = fake([inv(1, '2026-11-01T00:00:00Z'), inv(2, '2026-11-02T00:00:00Z')]);
    await new DetectOverdueInvoicesUseCase(f.uow, () => NOW).execute();
    const ids = new Set(f.events.map((e) => e.correlationId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^overdue-20261115-[0-9a-f]{8}$/);
    expect([...ids][0]).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
  });
  it('is idempotent: a second pass finds nothing new', async () => {
    const f = fake([inv(1, '2026-11-01T00:00:00Z')]);
    const uc = new DetectOverdueInvoicesUseCase(f.uow, () => NOW);
    expect(await uc.execute()).toEqual({ detected: 1 });
    expect(await uc.execute()).toEqual({ detected: 0 });
    expect(f.events).toHaveLength(1);
  });
  it('an invoice another detector wrote a moment ago is not counted or duplicated (the write says false)', async () => {
    const f = fake([inv(1, '2026-11-01T00:00:00Z')]);
    f.events.push({} as any); // ya existía
    const uow: OverdueUnitOfWork = { run: (work) => f.uow.run((tx) => work({ ...tx, addToOutbox: async () => false })) };
    expect(await new DetectOverdueInvoicesUseCase(uow, () => NOW).execute()).toEqual({ detected: 0 });
  });
  it('if writing an event fails nothing of the pass stays (all or nothing)', async () => {
    const f = fake([inv(1, '2026-11-01T00:00:00Z'), inv(2, '2026-11-02T00:00:00Z'), inv(3, '2026-11-03T00:00:00Z')], 1);
    await expect(new DetectOverdueInvoicesUseCase(f.uow, () => NOW).execute()).rejects.toThrow('outbox down');
    expect(f.events).toHaveLength(0);
  });
  it('the event carries no personal data: only business fields', async () => {
    const f = fake([inv(1, '2026-11-01T00:00:00Z', { approvedBy: 'laura.rios@nexus.example', issuedBy: 'andres.mora@nexus.example' })]);
    await new DetectOverdueInvoicesUseCase(f.uow, () => NOW).execute();
    expect(Object.keys(f.events[0].data).sort()).toEqual(['amountCop', 'clientName', 'daysOverdue', 'dueDate', 'invoiceNumber', 'milestoneId', 'milestoneName', 'projectName', 'taxCop', 'totalCop']);
    expect(JSON.stringify(f.events[0])).not.toMatch(/@/);
  });
});
