import { Prisma, PrismaClient } from '@prisma/client';
import { aggregateOf, BillingEvent, routingKeyOf } from '../domain/events';
import { Payment } from '../domain/payment';
import { PaymentQueries, PaymentScope, PaymentUnitOfWork } from '../domain/ports';
import { toDomain } from './prisma-invoice-queries';

const TX = { timeout: 10_000, maxWait: 10_000 };

export class PrismaPaymentUnitOfWork implements PaymentUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: PaymentScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new Scope(c)), TX);
  }
}

class Scope implements PaymentScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async lockInvoice(number: string) {
    // FOR UPDATE: otro pago a la MISMA factura espera aquí y, al continuar, ya ve lo que dejó el primero.
    const rows = await this.tx.$queryRaw<any[]>`
      SELECT number, milestone_id AS "milestoneId", project_name AS "projectName", milestone_name AS "milestoneName", amount_cop AS "amountCop", tax_cop AS "taxCop", total_cop AS "totalCop",
             status::text AS status, created_at AS "createdAt", issued_at AS "issuedAt", issued_by AS "issuedBy", source_event_id AS "sourceEventId", approved_by AS "approvedBy",
             approved_at AS "approvedAt", due_date AS "dueDate", client_name AS "clientName"
      FROM invoices WHERE number = ${number} FOR UPDATE`;
    if (!rows[0]) return null;
    // La suma se lee DESPUÉS del bloqueo.
    const [{ paid }] = await this.tx.$queryRaw<{ paid: bigint }[]>`SELECT COALESCE(SUM(amount_cop), 0) AS paid FROM payments WHERE invoice_number = ${number}`;
    return { invoice: toDomain(rows[0]), paidCop: Number(paid) };
  }

  async insertPayment(p: Payment) {
    await this.tx.payment.create({ data: { id: p.id, invoiceNumber: p.invoiceNumber, amountCop: p.amountCop, method: p.method, reference: p.reference, paidAt: p.paidAt, registeredBy: p.registeredBy } });
  }

  async addToOutbox(event: BillingEvent) {
    await this.tx.outboxEvent.create({ data: { id: event.eventId, aggregateId: aggregateOf(event), type: event.type, routingKey: routingKeyOf(event), payload: event as unknown as Prisma.InputJsonValue } });
  }
}

export class PrismaPaymentQueries implements PaymentQueries {
  constructor(private readonly prisma: PrismaClient) {}
  async listForInvoice(number: string): Promise<Payment[] | null> {
    if ((await this.prisma.invoice.count({ where: { number } })) === 0) return null;
    const rows = await this.prisma.payment.findMany({ where: { invoiceNumber: number }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], take: 500 });
    return rows.map((r) => ({ id: r.id, invoiceNumber: r.invoiceNumber, amountCop: r.amountCop, method: r.method as Payment['method'], reference: r.reference, paidAt: r.paidAt, registeredBy: r.registeredBy }));
  }
}
