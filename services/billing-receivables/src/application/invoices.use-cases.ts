import { InvoiceNotFoundError } from '../domain/errors';
import { invoiceIssued } from '../domain/events';
import { issue } from '../domain/invoice';
import { InvoiceQueries, IssueUnitOfWork } from '../domain/ports';
import { reconcile } from '../domain/reconciliation';

export class ListInvoicesUseCase {
  constructor(private readonly queries: InvoiceQueries) {}
  execute() { return this.queries.list(); }
}

export class ReconcileInvoicesUseCase {
  constructor(private readonly queries: InvoiceQueries) {}
  async execute() { return reconcile(await this.queries.list()); }
}

export class IssueInvoiceUseCase {
  constructor(private readonly uow: IssueUnitOfWork, private readonly clock: () => Date = () => new Date()) {}

  execute(number: string, issuedBy: string, correlationId: string) {
    return this.uow.run(async (tx) => {
      const found = await tx.findForUpdate(number);
      if (!found) throw new InvoiceNotFoundError(number);
      const issued = issue(found, issuedBy, this.clock());
      await tx.save(issued);
      await tx.addToOutbox(invoiceIssued(issued, correlationId, this.clock()));
      return issued;
    });
  }
}
