import { PrismaClient } from '@prisma/client';
import { Invoice } from '../domain/invoice';
import { customerKey } from '../domain/einvoice/customer';
import { electronicStatusOf } from '../domain/einvoice/status';
import { InvoiceListItem, InvoiceQueries } from '../domain/ports';

export const toDomain = (r: any): Invoice => ({
  number: r.number, milestoneId: r.milestoneId, projectName: r.projectName, milestoneName: r.milestoneName, amountCop: r.amountCop, taxCop: r.taxCop, totalCop: r.totalCop,
  status: r.status, createdAt: r.createdAt, issuedAt: r.issuedAt, issuedBy: r.issuedBy, sourceEventId: r.sourceEventId, approvedBy: r.approvedBy, approvedAt: r.approvedAt, dueDate: r.dueDate, clientName: r.clientName ?? null,
});

export class PrismaInvoiceQueries implements InvoiceQueries {
  constructor(private readonly prisma: PrismaClient) {}
  async list(): Promise<InvoiceListItem[]> {
    const [rows, customers] = await Promise.all([
      this.prisma.invoice.findMany({ orderBy: [{ createdAt: 'desc' }, { number: 'desc' }], include: { electronic: { select: { status: true } } } }),
      this.prisma.customer.findMany({ select: { key: true } }),
    ]);
    const keys = new Set(customers.map((c) => c.key));
    const paidRows = await this.prisma.$queryRaw<{ n: string; paid: bigint }[]>`SELECT invoice_number AS n, SUM(amount_cop) AS paid FROM payments GROUP BY invoice_number`;
    const paid = new Map(paidRows.map((p) => [p.n, Number(p.paid)]));
    return rows.map((r) => {
      const i = toDomain(r);
      return { ...i, paidCop: paid.get(i.number) ?? 0, electronicStatus: electronicStatusOf(i, (r.electronic?.status ?? null) as any, !!i.clientName && keys.has(customerKey(i.clientName))) };
    });
  }
}
