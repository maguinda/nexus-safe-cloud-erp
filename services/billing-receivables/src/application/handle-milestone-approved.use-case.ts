import { invoiceDrafted } from '../domain/events';
import { Invoice } from '../domain/invoice';
import { parseMilestoneApproved } from '../domain/milestone-approved';
import { InboxUnitOfWork } from '../domain/ports';
import { computeTotals } from '../domain/tax';

export type HandleResult = 'created' | 'duplicate' | 'already-invoiced';

/**
 * Idempotente: RabbitMQ entrega "al menos una vez", así que el mismo evento puede llegar dos veces.
 * Dentro de una transacción se anota el eventId y se crea la factura; si algo falla, no queda ni lo uno ni lo otro
 * y el reintento puede procesarlo completo. Además hay a lo sumo una factura por hito.
 */
export class HandleMilestoneApprovedUseCase {
  constructor(private readonly uow: InboxUnitOfWork, private readonly clock: () => Date = () => new Date()) {}

  async execute(raw: unknown): Promise<HandleResult> {
    const event = parseMilestoneApproved(raw); // lanza InvalidEventError si el mensaje no cumple el contrato
    return this.uow.run(async (tx) => {
      if (!(await tx.markEventProcessed(event.eventId))) return 'duplicate';
      if (await tx.invoiceExistsForMilestone(event.data.milestoneId)) return 'already-invoiced';
      const { taxCop, totalCop } = computeTotals(event.data.amountCop);
      const invoice: Invoice = {
        number: await tx.nextInvoiceNumber(),
        milestoneId: event.data.milestoneId,
        projectName: event.data.projectName,
        milestoneName: event.data.milestoneName,
        amountCop: event.data.amountCop,
        taxCop,
        totalCop,
        status: 'draft',
        createdAt: this.clock(),
        issuedAt: null,
        issuedBy: null,
        sourceEventId: event.eventId,
        approvedBy: event.data.approvedBy,
        approvedAt: new Date(event.occurredAt),
      };
      await tx.insertInvoice(invoice);
      // El mismo correlationId del evento que originó la factura: una sola traza cruza projects, billing y analytics.
      await tx.addToOutbox(invoiceDrafted(invoice, event.correlationId, this.clock()));
      return 'created';
    });
  }
}
