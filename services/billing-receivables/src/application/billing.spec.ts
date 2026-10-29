import { HandleMilestoneApprovedUseCase } from './handle-milestone-approved.use-case';
import { IssueInvoiceUseCase } from './invoices.use-cases';
import { InvalidEventError, InvoiceNotDraftError, InvoiceNotFoundError } from '../domain/errors';
import { Invoice } from '../domain/invoice';
import { parseMilestoneApproved } from '../domain/milestone-approved';
import { InboxScope, InboxUnitOfWork, IssueUnitOfWork } from '../domain/ports';
import { BillingEvent } from '../domain/events';

const NOW = new Date('2026-10-18T06:00:00.000Z');
const ev = (over: any = {}, data: any = {}) => ({
  eventId: '6f1c2d9e-3b5a-4c71-9d2f-0a1b2c3d4e5f', type: 'MilestoneApproved', occurredAt: NOW.toISOString(), correlationId: 'corr-12345678',
  data: { milestoneId: 'm2', milestoneName: 'Link redundancy design', projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 18_500_000, approvedBy: 'laura.rios@nexus.example', ...data },
  ...over,
});

/** Base en memoria con transacción simulada: si el trabajo falla, se deshace todo. */
function fakeInbox(failOnInsert = false, failOnOutbox = false) {
  let processed = new Set<string>(); let invoices: Invoice[] = []; let seq = 103; let outbox: BillingEvent[] = [];
  const uow: InboxUnitOfWork = {
    async run(work) {
      const sp = new Set(processed), si = [...invoices], ss = seq, so = [...outbox];
      const tx: InboxScope = {
        markEventProcessed: async (id) => { if (processed.has(id)) return false; processed.add(id); return true; },
        invoiceExistsForMilestone: async (m) => invoices.some((i) => i.milestoneId === m),
        nextInvoiceNumber: async () => `INV-${String(seq++).padStart(4, '0')}`,
        insertInvoice: async (i) => { if (failOnInsert) throw new Error('db down'); invoices.push(i); },
        addToOutbox: async (e) => { if (failOnOutbox) throw new Error('outbox down'); outbox.push(e); },
      };
      try { return await work(tx); } catch (e) { processed = sp; invoices = si; seq = ss; outbox = so; throw e; }
    },
  };
  return { uow, get invoices() { return invoices; }, get processed() { return processed; }, get outbox() { return outbox; } };
}

describe('parseMilestoneApproved', () => {
  it('accepts a valid event and ignores unknown extra fields', () => {
    const e = parseMilestoneApproved(ev({ extra: 'x' }, { note: 'y' }));
    expect(e.data.milestoneId).toBe('m2');
    expect(e).not.toHaveProperty('extra');
    expect(e.data).not.toHaveProperty('note');
  });

  describe('clientName (new, optional)', () => {
    const client = (v: unknown) => parseMilestoneApproved(ev({}, { clientName: v })).data.clientName;
    it('an old event without it gives null; null and empty give null', () => {
      expect(parseMilestoneApproved(ev()).data.clientName).toBeNull();
      expect(client(null)).toBeNull(); expect(client('')).toBeNull(); expect(client('   \t ')).toBeNull();
    });
    it('keeps a normal name, collapses spaces and strips control and line-separator characters instead of refusing the event', () => {
      expect(client('  Banco   Andino (example) ')).toBe('Banco Andino (example)');
      expect(client('Banco\u0000\u0008 Andino\u2028X')).toBe('Banco Andino X');
      expect(client('Peña 🚀')).toBe('Peña 🚀');
    });
    it('120 characters is the limit; 121 or a non-text value is a bad event', () => {
      expect(client('a'.repeat(120))).toHaveLength(120);
      expect(() => client('a'.repeat(121))).toThrow(InvalidEventError);
      for (const bad of [5, {}, [], true]) expect(() => client(bad)).toThrow(InvalidEventError);
    });
  });

  it.each<[string, unknown]>([
    ['null', null], ['an array', []], ['a string', 'hello'],
    ['wrong type', ev({ type: 'MilestoneRejected' })],
    ['eventId not a UUID', ev({ eventId: '1; DROP TABLE invoices' })],
    ['occurredAt not a date', ev({ occurredAt: 'yesterday' })],
    ['correlationId with spaces', ev({ correlationId: 'bad id here!' })],
    ['data missing', ev({ data: undefined })],
    ['milestoneId with a slash', ev({}, { milestoneId: '../m2' })],
    ['milestoneId too long', ev({}, { milestoneId: 'm'.repeat(41) })],
    ['amount zero', ev({}, { amountCop: 0 })],
    ['amount negative', ev({}, { amountCop: -5 })],
    ['amount fractional', ev({}, { amountCop: 10.5 })],
    ['amount as string', ev({}, { amountCop: '100' })],
    ['amount absurdly large', ev({}, { amountCop: 9e15 })],
    ['amount over the 1,000,000,000 cap (total would overflow an Int)', ev({}, { amountCop: 1_000_000_001 })],
    ['approvedBy not an email', ev({}, { approvedBy: 'laura' })],
    ['empty project name', ev({}, { projectName: '   ' })],
    ['project name too long', ev({}, { projectName: 'x'.repeat(201) })],
    ['milestone name as object', ev({}, { milestoneName: { $ne: 1 } })],
  ])('rejects %s', (_n, raw) => {
    expect(() => parseMilestoneApproved(raw)).toThrow(InvalidEventError);
  });
});

describe('HandleMilestoneApprovedUseCase', () => {
  it('creates a draft invoice with the next number from the event data', async () => {
    const db = fakeInbox();
    expect(await new HandleMilestoneApprovedUseCase(db.uow, () => NOW).execute(ev())).toBe('created');
    expect(db.invoices[0].dueDate).toBeNull(); // el vencimiento se fija al emitir, no al crear el borrador
    expect(db.invoices).toEqual([expect.objectContaining({ number: 'INV-0103', milestoneId: 'm2', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', amountCop: 18_500_000, taxCop: 3_515_000, totalCop: 22_015_000, approvedBy: 'laura.rios@nexus.example', status: 'draft', createdAt: NOW, issuedAt: null, sourceEventId: '6f1c2d9e-3b5a-4c71-9d2f-0a1b2c3d4e5f' })]);
  });

  it('ignores the same event delivered twice', async () => {
    const db = fakeInbox(); const uc = new HandleMilestoneApprovedUseCase(db.uow, () => NOW);
    await uc.execute(ev());
    expect(await uc.execute(ev())).toBe('duplicate');
    expect(db.invoices).toHaveLength(1);
  });

  it('creates only one invoice per milestone even with a new eventId (replayed approval)', async () => {
    const db = fakeInbox(); const uc = new HandleMilestoneApprovedUseCase(db.uow, () => NOW);
    await uc.execute(ev());
    expect(await uc.execute(ev({ eventId: '11111111-2222-4333-8444-555555555555' }))).toBe('already-invoiced');
    expect(db.invoices).toHaveLength(1);
  });

  it('rejects an invalid message before touching the database', async () => {
    const db = fakeInbox();
    await expect(new HandleMilestoneApprovedUseCase(db.uow).execute(ev({}, { amountCop: -1 }))).rejects.toBeInstanceOf(InvalidEventError);
    expect(db.processed.size).toBe(0);
  });

  it('writes InvoiceDrafted to the outbox in the same transaction, with the correlation id of the original event', async () => {
    const db = fakeInbox();
    await new HandleMilestoneApprovedUseCase(db.uow, () => NOW).execute(ev());
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]).toMatchObject({
      type: 'InvoiceDrafted', occurredAt: NOW.toISOString(), correlationId: 'corr-12345678',
      data: { invoiceNumber: 'INV-0103', milestoneId: 'm2', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', amountCop: 18_500_000, taxCop: 3_515_000, totalCop: 22_015_000, approvedBy: 'laura.rios@nexus.example' },
    });
    expect(db.outbox[0].eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a repeated MilestoneApproved adds no second event to the outbox', async () => {
    const db = fakeInbox(); const uc = new HandleMilestoneApprovedUseCase(db.uow, () => NOW);
    await uc.execute(ev()); await uc.execute(ev());
    expect(db.outbox).toHaveLength(1);
  });

  it('if the outbox fails, neither the invoice nor the processed mark stays (all or nothing)', async () => {
    const db = fakeInbox(false, true);
    await expect(new HandleMilestoneApprovedUseCase(db.uow).execute(ev())).rejects.toThrow('outbox down');
    expect(db.invoices).toHaveLength(0);
    expect(db.processed.size).toBe(0);
    expect(db.outbox).toHaveLength(0);
  });

  it('leaves the event unprocessed if the insert fails, so a retry can finish the job', async () => {
    const broken = fakeInbox(true);
    await expect(new HandleMilestoneApprovedUseCase(broken.uow).execute(ev())).rejects.toThrow('db down');
    expect(broken.processed.size).toBe(0);
    expect(broken.invoices).toHaveLength(0);
  });
});

describe('IssueInvoiceUseCase', () => {
  const draft: Invoice = { number: 'INV-0103', milestoneId: 'm2', projectName: 'P', milestoneName: 'M', amountCop: 5, taxCop: 1, totalCop: 6, status: 'draft', approvedBy: null, approvedAt: null, createdAt: NOW, issuedAt: null, issuedBy: null, sourceEventId: null, dueDate: null, clientName: null };
  let outbox: BillingEvent[] = [];
  beforeEach(() => { outbox = []; });
  // Transacción simulada: si el trabajo falla, se deshacen la factura y el outbox.
  const uowFor = (store: Map<string, Invoice>, failOnOutbox = false): IssueUnitOfWork => ({
    async run(work) {
      const snap = new Map(store), so = [...outbox];
      try {
        return await work({
          findForUpdate: async (n) => store.get(n) ?? null,
          save: async (i) => { store.set(i.number, i); },
          addToOutbox: async (e) => { if (failOnOutbox) throw new Error('outbox down'); outbox.push(e); },
        });
      } catch (e) { store.clear(); snap.forEach((v, k) => store.set(k, v)); outbox = so; throw e; }
    },
  });

  it('issues a draft and records who and when', async () => {
    const store = new Map([[draft.number, draft]]);
    const r = await new IssueInvoiceUseCase(uowFor(store), () => NOW).execute('INV-0103', 'andres.mora@nexus.example', 'corr-issue-0001');
    expect(r).toMatchObject({ status: 'issued', issuedBy: 'andres.mora@nexus.example', issuedAt: NOW, dueDate: new Date('2026-11-17T06:00:00.000Z') });
    expect(draft.status).toBe('draft'); // el original no se muta
  });
  it('writes InvoiceIssued to the outbox with who issued it and the request correlation id', async () => {
    const store = new Map([[draft.number, draft]]);
    await new IssueInvoiceUseCase(uowFor(store), () => NOW).execute('INV-0103', 'andres.mora@nexus.example', 'corr-issue-0001');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: 'InvoiceIssued', occurredAt: NOW.toISOString(), correlationId: 'corr-issue-0001', data: { invoiceNumber: 'INV-0103', milestoneId: 'm2', amountCop: 5, taxCop: 1, totalCop: 6, issuedBy: 'andres.mora@nexus.example', dueDate: '2026-11-17T06:00:00.000Z' } });
  });
  it('if the outbox fails the invoice stays a draft (all or nothing)', async () => {
    const store = new Map([[draft.number, draft]]);
    await expect(new IssueInvoiceUseCase(uowFor(store, true), () => NOW).execute('INV-0103', 'a@x.co', 'corr-a-12345')).rejects.toThrow('outbox down');
    expect(store.get('INV-0103')?.status).toBe('draft');
    expect(outbox).toHaveLength(0);
  });
  it('refusing to issue twice writes no second event', async () => {
    const store = new Map([[draft.number, draft]]); const uc = new IssueInvoiceUseCase(uowFor(store), () => NOW);
    await uc.execute('INV-0103', 'a@x.co', 'corr-a-12345');
    await expect(uc.execute('INV-0103', 'b@x.co', 'corr-b-12345')).rejects.toBeInstanceOf(InvoiceNotDraftError);
    expect(outbox).toHaveLength(1);
  });
  it('refuses to issue twice', async () => {
    const store = new Map([[draft.number, draft]]); const uc = new IssueInvoiceUseCase(uowFor(store), () => NOW);
    await uc.execute('INV-0103', 'a@x.co', 'corr-a-12345');
    await expect(uc.execute('INV-0103', 'b@x.co', 'corr-b-12345')).rejects.toBeInstanceOf(InvoiceNotDraftError);
    expect(store.get('INV-0103')?.issuedBy).toBe('a@x.co');
  });
  it('fails for an unknown invoice', async () => {
    await expect(new IssueInvoiceUseCase(uowFor(new Map())).execute('INV-9999', 'a@x.co', 'corr-c-12345')).rejects.toBeInstanceOf(InvoiceNotFoundError);
  });
});
