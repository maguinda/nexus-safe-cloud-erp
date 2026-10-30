import { Prisma, PrismaClient } from '@prisma/client';
import { BillingEvent, routingKeyOf } from '../domain/events';
import { Invoice } from '../domain/invoice';
import { InboxScope, InboxUnitOfWork, IssueScope, IssueUnitOfWork, OverdueScope, OverdueUnitOfWork } from '../domain/ports';
import { toDomain } from './prisma-invoice-queries';

const TX = { timeout: 10_000, maxWait: 10_000 };

export class PrismaInboxUnitOfWork implements InboxUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: InboxScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new PrismaInboxScope(c)), TX);
  }
}

/** Guarda el aviso en la bandeja de salida, dentro de la transacción que recibe. */
async function writeOutbox(tx: Prisma.TransactionClient, event: BillingEvent): Promise<void> {
  await tx.outboxEvent.create({
    data: { id: event.eventId, aggregateId: event.data.invoiceNumber, type: event.type, routingKey: routingKeyOf(event), payload: event as unknown as Prisma.InputJsonValue },
  });
}

class PrismaInboxScope implements InboxScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async markEventProcessed(eventId: string): Promise<boolean> {
    // ON CONFLICT DO NOTHING: si dos copias del mismo evento llegan a la vez, la segunda espera a la primera y recibe 0 filas.
    const n = await this.tx.$executeRaw`INSERT INTO processed_events (event_id) VALUES (${eventId}::uuid) ON CONFLICT (event_id) DO NOTHING`;
    return n === 1;
  }

  async invoiceExistsForMilestone(milestoneId: string): Promise<boolean> {
    return (await this.tx.invoice.count({ where: { milestoneId } })) > 0;
  }

  async nextInvoiceNumber(): Promise<string> {
    const rows = await this.tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_number_seq') AS n`;
    return `INV-${String(rows[0].n).padStart(4, '0')}`;
  }

  addToOutbox(event: BillingEvent): Promise<void> {
    return writeOutbox(this.tx, event);
  }

  async insertInvoice(i: Invoice): Promise<void> {
    await this.tx.invoice.create({
      data: { number: i.number, milestoneId: i.milestoneId, projectName: i.projectName, milestoneName: i.milestoneName, amountCop: i.amountCop, taxCop: i.taxCop, totalCop: i.totalCop, status: i.status, createdAt: i.createdAt, sourceEventId: i.sourceEventId, approvedBy: i.approvedBy, approvedAt: i.approvedAt, clientName: i.clientName },
    });
  }
}

export class PrismaIssueUnitOfWork implements IssueUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: IssueScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new PrismaIssueScope(c)), TX);
  }
}

class PrismaIssueScope implements IssueScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async findForUpdate(number: string): Promise<Invoice | null> {
    // FOR UPDATE: dos personas emitiendo la misma factura a la vez no pueden ganar las dos.
    const rows = await this.tx.$queryRaw<any[]>`
      SELECT number, milestone_id AS "milestoneId", project_name AS "projectName", milestone_name AS "milestoneName", amount_cop AS "amountCop", tax_cop AS "taxCop", total_cop AS "totalCop",
             status::text AS status, created_at AS "createdAt", issued_at AS "issuedAt", issued_by AS "issuedBy", source_event_id AS "sourceEventId", approved_by AS "approvedBy", approved_at AS "approvedAt", due_date AS "dueDate", client_name AS "clientName"
      FROM invoices WHERE number = ${number} FOR UPDATE`;
    return rows[0] ? toDomain(rows[0]) : null;
  }

  addToOutbox(event: BillingEvent): Promise<void> {
    return writeOutbox(this.tx, event);
  }

  async save(i: Invoice): Promise<void> {
    await this.tx.invoice.update({ where: { number: i.number }, data: { status: i.status, issuedAt: i.issuedAt, issuedBy: i.issuedBy, dueDate: i.dueDate } });
  }
}

export class PrismaOverdueUnitOfWork implements OverdueUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: OverdueScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new PrismaOverdueScope(c)), TX);
  }
}

class PrismaOverdueScope implements OverdueScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async findNewlyOverdue(today: string, limit: number): Promise<Invoice[]> {
    // Vencida = emitida y con día de vencimiento (UTC) ANTERIOR a hoy, sin su evento todavía. SKIP LOCKED: otro detector que corra a la vez toma otras filas.
    const rows = await this.tx.$queryRaw<any[]>`
      SELECT i.number, i.milestone_id AS "milestoneId", i.project_name AS "projectName", i.milestone_name AS "milestoneName", i.amount_cop AS "amountCop", i.tax_cop AS "taxCop",
             i.total_cop AS "totalCop", i.status::text AS status, i.created_at AS "createdAt", i.issued_at AS "issuedAt", i.issued_by AS "issuedBy", i.source_event_id AS "sourceEventId",
             i.approved_by AS "approvedBy", i.approved_at AS "approvedAt", i.due_date AS "dueDate", i.client_name AS "clientName"
      FROM invoices i
      WHERE i.status = 'issued' AND i.due_date IS NOT NULL AND i.due_date::date < ${today}::date
        AND NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.aggregate_id = i.number AND o.type = 'OverdueDetected')
        -- Una factura pagada del todo ya no está por cobrar: no vence.
        AND COALESCE((SELECT SUM(p.amount_cop) FROM payments p WHERE p.invoice_number = i.number), 0) < i.total_cop
      ORDER BY i.due_date, i.number LIMIT ${limit} FOR UPDATE OF i SKIP LOCKED`;
    return rows.map(toDomain);
  }

  async addToOutbox(event: BillingEvent): Promise<boolean> {
    const n = await this.tx.$executeRaw`
      INSERT INTO outbox_events (id, aggregate_id, type, routing_key, payload)
      VALUES (${event.eventId}::uuid, ${event.data.invoiceNumber}, ${event.type}, ${routingKeyOf(event)}, ${JSON.stringify(event)}::jsonb)
      ON CONFLICT (aggregate_id, type) DO NOTHING`;
    return n === 1;
  }
}
