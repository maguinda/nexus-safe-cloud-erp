import { Prisma, PrismaClient } from '@prisma/client';
import { toString as qrToString } from 'qrcode';
import { Party } from '../domain/einvoice/document';
import { FiscalCustomer } from '../domain/einvoice/customer';
import { EInvoiceStatus } from '../domain/einvoice/legal';
import { DeliveryLimitError, NumberingExhaustedError } from '../domain/errors';
import { CustomerRepository, EInvoiceRepository, EInvoiceScope, EInvoiceUnitOfWork, InvoiceSummary, NewEInvoice, Numbering, QrRenderer, StoredEInvoice } from '../domain/ports';
import { toDomain } from './prisma-invoice-queries';

const TX = { timeout: 10_000, maxWait: 10_000 };
/** Un documento no admite más de este número de registros de envío (frena el abuso del botón). */
export const MAX_DELIVERIES_PER_DOCUMENT = 20;

type Row = {
  id: string; invoiceNumber: string; number: string; issueDate: string; issueTime: string; dueDate: string; cufe: string; environment: string; status: string; xml: string; qrText: string;
  supplier: unknown; customer: unknown; invoiceSnapshot: unknown; providerRef: string | null; submittedAt: Date | null; createdAt: Date; deliveries: number;
};
const toStored = (r: Row): StoredEInvoice => ({
  id: r.id, invoiceNumber: r.invoiceNumber, number: r.number, issueDate: r.issueDate, issueTime: r.issueTime, dueDate: r.dueDate, cufe: r.cufe, environment: 'sandbox', status: r.status as EInvoiceStatus,
  xml: r.xml, qrText: r.qrText, supplier: r.supplier as Party, customer: r.customer as Party, invoice: r.invoiceSnapshot as InvoiceSummary, providerRef: r.providerRef, submittedAt: r.submittedAt, createdAt: r.createdAt, deliveries: Number(r.deliveries),
});

/** Una consulta que trae el documento con el número de su factura y cuántos envíos tiene. */
const SELECT = Prisma.sql`SELECT e.id, i.number AS "invoiceNumber", e.number, e.issue_date AS "issueDate", e.issue_time AS "issueTime", e.due_date AS "dueDate", e.cufe, e.environment, e.status, e.xml,
  e.qr_text AS "qrText", e.supplier, e.customer, e.invoice_snapshot AS "invoiceSnapshot", e.provider_ref AS "providerRef", e.submitted_at AS "submittedAt", e.created_at AS "createdAt",
  (SELECT COUNT(*) FROM einvoice_deliveries d WHERE d.einvoice_id = e.id)::int AS deliveries
  FROM electronic_invoices e JOIN invoices i ON i.id = e.invoice_id`;

export class PrismaEInvoiceUnitOfWork implements EInvoiceUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: EInvoiceScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new PrismaEInvoiceScope(c)), TX);
  }
}

class PrismaEInvoiceScope implements EInvoiceScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async findInvoiceForUpdate(number: string) {
    const rows = await this.tx.$queryRaw<any[]>`
      SELECT number, milestone_id AS "milestoneId", project_name AS "projectName", milestone_name AS "milestoneName", amount_cop AS "amountCop", tax_cop AS "taxCop", total_cop AS "totalCop",
             status::text AS status, created_at AS "createdAt", issued_at AS "issuedAt", issued_by AS "issuedBy", source_event_id AS "sourceEventId", approved_by AS "approvedBy",
             approved_at AS "approvedAt", due_date AS "dueDate", client_name AS "clientName"
      FROM invoices WHERE number = ${number} FOR UPDATE`;
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findElectronic(invoiceNumber: string) {
    const rows = await this.tx.$queryRaw<Row[]>(Prisma.sql`${SELECT} WHERE i.number = ${invoiceNumber}`);
    return rows[0] ? toStored(rows[0]) : null;
  }

  async findCustomerForShare(key: string): Promise<FiscalCustomer | null> {
    const rows = await this.tx.$queryRaw<FiscalCustomer[]>`SELECT name, nit, dv, email, address, city FROM customers WHERE key = ${key} FOR SHARE`;
    return rows[0] ?? null;
  }

  async takeNextConsecutive(): Promise<Numbering> {
    // Una sola sentencia: lee, incrementa y devuelve bajo el bloqueo de la fila. Si se agotó el rango no actualiza nada (0 filas).
    const rows = await this.tx.$queryRaw<{ prefix: string; taken: number; validFrom: Date; validTo: Date }[]>`
      UPDATE einvoice_numbering SET next_number = next_number + 1
      WHERE id = 1 AND next_number <= range_to
      RETURNING prefix, next_number - 1 AS taken, valid_from AS "validFrom", valid_to AS "validTo"`;
    if (!rows[0]) throw new NumberingExhaustedError();
    return { prefix: rows[0].prefix, consecutive: rows[0].taken, validFrom: rows[0].validFrom, validTo: rows[0].validTo };
  }

  async insertElectronic(e: NewEInvoice): Promise<StoredEInvoice> {
    await this.tx.$executeRaw`
      INSERT INTO electronic_invoices (id, invoice_id, prefix, consecutive, number, issue_date, issue_time, due_date, cufe, environment, status, xml, qr_text, supplier, customer, invoice_snapshot)
      SELECT gen_random_uuid(), i.id, ${e.prefix}, ${e.consecutive}, ${e.number}, ${e.issueDate}, ${e.issueTime}, ${e.dueDate}, ${e.cufe}, 'sandbox', 'generated', ${e.xml}, ${e.qrText},
             ${JSON.stringify(e.supplier)}::jsonb, ${JSON.stringify(e.customer)}::jsonb, ${JSON.stringify(e.invoice)}::jsonb
      FROM invoices i WHERE i.number = ${e.invoiceNumber}`;
    const rows = await this.tx.$queryRaw<Row[]>(Prisma.sql`${SELECT} WHERE i.number = ${e.invoiceNumber}`);
    return toStored(rows[0]);
  }
}

export class PrismaEInvoiceRepository implements EInvoiceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByInvoiceNumber(invoiceNumber: string) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`${SELECT} WHERE i.number = ${invoiceNumber}`);
    return rows[0] ? toStored(rows[0]) : null;
  }

  async markSubmitted(invoiceNumber: string, providerRef: string, at: Date) {
    // Condicionado al estado: de dos envíos a la vez solo el primero cambia la fila; el segundo no pisa la referencia del primero.
    await this.prisma.$executeRaw`
      UPDATE electronic_invoices SET status = 'sandbox_simulated', provider_ref = ${providerRef}, submitted_at = ${at}
      WHERE status = 'generated' AND invoice_id = (SELECT id FROM invoices WHERE number = ${invoiceNumber})`;
    return this.findByInvoiceNumber(invoiceNumber);
  }

  async addDelivery(invoiceNumber: string, recipient: string) {
    await this.prisma.$transaction(async (tx) => {
      // El tope se comprueba bajo el bloqueo del documento: dos clics a la vez no lo pasan.
      const doc = await tx.$queryRaw<{ id: string }[]>`SELECT e.id FROM electronic_invoices e JOIN invoices i ON i.id = e.invoice_id WHERE i.number = ${invoiceNumber} FOR UPDATE OF e`;
      if (!doc[0]) return;
      const n = await tx.eInvoiceDelivery.count({ where: { einvoiceId: doc[0].id } });
      if (n >= MAX_DELIVERIES_PER_DOCUMENT) throw new DeliveryLimitError(MAX_DELIVERIES_PER_DOCUMENT); // nunca en silencio: la pantalla no puede decir «registrado» si no lo está
      await tx.eInvoiceDelivery.create({ data: { einvoiceId: doc[0].id, channel: 'email', recipient, status: 'logged' } });
    }, TX);
    return this.findByInvoiceNumber(invoiceNumber);
  }
}

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list() {
    const rows = await this.prisma.customer.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => ({ name: r.name, nit: r.nit, dv: r.dv, email: r.email, address: r.address, city: r.city, updatedAt: r.updatedAt }));
  }

  async upsert(c: FiscalCustomer, key: string): Promise<FiscalCustomer> {
    await this.prisma.$executeRaw`
      INSERT INTO customers (id, key, name, nit, dv, email, address, city)
      VALUES (gen_random_uuid(), ${key}, ${c.name}, ${c.nit}, ${c.dv}, ${c.email}, ${c.address}, ${c.city})
      ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, nit = EXCLUDED.nit, dv = EXCLUDED.dv, email = EXCLUDED.email, address = EXCLUDED.address, city = EXCLUDED.city, updated_at = now()`;
    return c;
  }
}

export class QrCodeRenderer implements QrRenderer {
  toSvg(text: string): Promise<string> {
    return qrToString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  }
}
