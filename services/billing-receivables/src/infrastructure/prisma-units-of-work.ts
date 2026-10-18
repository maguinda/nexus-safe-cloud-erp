import { Prisma, PrismaClient } from '@prisma/client';
import { Invoice } from '../domain/invoice';
import { InboxScope, InboxUnitOfWork, IssueScope, IssueUnitOfWork } from '../domain/ports';
import { toDomain } from './prisma-invoice-queries';

const TX = { timeout: 10_000, maxWait: 10_000 };

export class PrismaInboxUnitOfWork implements InboxUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: InboxScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new PrismaInboxScope(c)), TX);
  }
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

  async insertInvoice(i: Invoice): Promise<void> {
    await this.tx.invoice.create({
      data: { number: i.number, milestoneId: i.milestoneId, projectName: i.projectName, milestoneName: i.milestoneName, amountCop: i.amountCop, taxCop: i.taxCop, totalCop: i.totalCop, status: i.status, createdAt: i.createdAt, sourceEventId: i.sourceEventId, approvedBy: i.approvedBy, approvedAt: i.approvedAt },
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
             status::text AS status, created_at AS "createdAt", issued_at AS "issuedAt", issued_by AS "issuedBy", source_event_id AS "sourceEventId", approved_by AS "approvedBy", approved_at AS "approvedAt"
      FROM invoices WHERE number = ${number} FOR UPDATE`;
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async save(i: Invoice): Promise<void> {
    await this.tx.invoice.update({ where: { number: i.number }, data: { status: i.status, issuedAt: i.issuedAt, issuedBy: i.issuedBy } });
  }
}
