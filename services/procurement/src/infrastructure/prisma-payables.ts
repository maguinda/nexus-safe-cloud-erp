import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors';

const TX = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 10_000 } as const;
export const PAYABLE_METHODS = ['transfer', 'cash', 'card', 'check'] as const;
export const SUPPLIER_PAID_ROUTING_KEY = 'procurement.supplier.paid';
export const payableNumber = (n: number) => `CP-${String(n).padStart(4, '0')}`;

const view = (p: { id: string; number: number; orderId: string; supplierName: string; amountCop: number; dueDate: Date; projectName: string | null; status: string; createdAt: Date; paidAt: Date | null; paidBy: string | null; method: string | null; reference: string | null }, today: string) => ({
  id: p.id, number: payableNumber(p.number), orderId: p.orderId, supplierName: p.supplierName, amountCop: p.amountCop, dueDate: p.dueDate.toISOString().slice(0, 10), projectName: p.projectName,
  status: p.status as 'open' | 'paid', overdue: p.status === 'open' && p.dueDate.toISOString().slice(0, 10) < today, createdAt: p.createdAt.toISOString(), paidAt: p.paidAt?.toISOString() ?? null, paidBy: p.paidBy, method: p.method, reference: p.reference,
});

/** Lo que se le debe a los proveedores. Pagar bloquea la deuda, relee el estado dentro del bloqueo y la marca pagada UNA vez; avisa con SupplierPaid (outbox, misma transacción). */
export class PayablesService {
  constructor(private readonly prisma: PrismaClient, private readonly clock: () => Date = () => new Date()) {}

  async list() {
    const today = this.clock().toISOString().slice(0, 10);
    const rows = await this.prisma.payable.findMany({ orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { number: 'asc' }], take: 300 });
    const out = rows.map((r) => view(r, today));
    return { payables: out, openCop: out.filter((p) => p.status === 'open').reduce((s, p) => s + p.amountCop, 0), overdueCop: out.filter((p) => p.overdue).reduce((s, p) => s + p.amountCop, 0) };
  }

  async pay(id: string, methodRaw: unknown, referenceRaw: unknown, actor: string, correlationId: string) {
    if (typeof methodRaw !== 'string' || !(PAYABLE_METHODS as readonly string[]).includes(methodRaw)) throw new ValidationError(`method must be one of: ${PAYABLE_METHODS.join(', ')}`);
    let reference: string | null = null;
    if (referenceRaw !== undefined && referenceRaw !== null && referenceRaw !== '') {
      const r = typeof referenceRaw === 'string' ? referenceRaw.replace(/\s+/g, ' ').trim() : '';
      // eslint-disable-next-line no-control-regex
      if (r.length < 3 || r.length > 60 || /[\u0000-\u001f<>]/.test(r)) throw new ValidationError('reference must be 3 to 60 characters without < > or control characters');
      reference = r;
    }
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM payables WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundError('Payable');
      if (rows[0].status !== 'open') throw new ConflictError('That payable is already paid');
      const now = this.clock();
      const p = await tx.payable.update({ where: { id }, data: { status: 'paid', paidAt: now, paidBy: actor, method: methodRaw, reference } });
      const ev = { eventId: randomUUID(), type: 'SupplierPaid', occurredAt: now.toISOString(), correlationId, data: { payableNumber: payableNumber(p.number), supplierName: p.supplierName, amountCop: p.amountCop, projectName: p.projectName, method: methodRaw, paidBy: actor } };
      await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: p.id, type: ev.type, routingKey: SUPPLIER_PAID_ROUTING_KEY, payload: ev as unknown as Prisma.InputJsonValue } });
      return view(p, now.toISOString().slice(0, 10));
    }, TX);
  }
}
