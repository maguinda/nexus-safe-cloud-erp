import { Prisma, PrismaClient } from '@prisma/client';
import { QuoteContractStore, QuoteHandleResult } from '../application/handle-quote-approved.use-case';
import { QuoteApprovedEvent } from '../domain/quote-approved';

export class PrismaQuoteContracts implements QuoteContractStore {
  constructor(private readonly prisma: PrismaClient) {}
  async createContractFromQuote(e: QuoteApprovedEvent, startDate: string, endDate: string): Promise<QuoteHandleResult> {
    return this.prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING en las dos tablas: dos copias del evento a la vez, la segunda espera a la primera y no crea nada.
      const first = await tx.$executeRaw`INSERT INTO processed_events (event_id) VALUES (${e.eventId}::uuid) ON CONFLICT (event_id) DO NOTHING`;
      if (first !== 1) return 'duplicate';
      const n = await tx.$executeRaw`
        INSERT INTO contracts (client_name, project_name, project_id, quote_ref, amount_cop, start_date, end_date, created_by)
        VALUES (${e.data.clientName}, ${e.data.projectName}, ${e.data.projectId}, ${e.data.quoteNumber}, ${e.data.amountCop}, ${startDate}::date, ${endDate}::date, ${e.data.approvedBy})
        ON CONFLICT (quote_ref) DO NOTHING`;
      return n === 1 ? 'created' : 'duplicate';
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  }
}
