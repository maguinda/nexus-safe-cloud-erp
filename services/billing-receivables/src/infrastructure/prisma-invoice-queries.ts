import { PrismaClient } from '@prisma/client';
import { Invoice } from '../domain/invoice';
import { InvoiceQueries } from '../domain/ports';

export const toDomain = (r: any): Invoice => ({
  number: r.number, milestoneId: r.milestoneId, projectName: r.projectName, milestoneName: r.milestoneName, amountCop: r.amountCop,
  status: r.status, createdAt: r.createdAt, issuedAt: r.issuedAt, issuedBy: r.issuedBy, sourceEventId: r.sourceEventId,
});

export class PrismaInvoiceQueries implements InvoiceQueries {
  constructor(private readonly prisma: PrismaClient) {}
  async list(): Promise<Invoice[]> {
    const rows = await this.prisma.invoice.findMany({ orderBy: [{ createdAt: 'desc' }, { number: 'desc' }] });
    return rows.map(toDomain);
  }
}
