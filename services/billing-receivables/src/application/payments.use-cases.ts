import { InvoiceNotFoundError, OverpaymentError, PaymentNotAllowedError } from '../domain/errors';
import { paymentReceived } from '../domain/events';
import { balanceOf, Payment, paymentStatusOf, validatePayment } from '../domain/payment';
import { PaymentQueries, PaymentUnitOfWork } from '../domain/ports';
import { randomUUID } from 'crypto';

/**
 * Registrar un pago. Se bloquea la FACTURA, se suma lo ya pagado DENTRO del bloqueo (no antes) y solo entonces se decide: dos pagos a la vez
 * no pueden pasar juntos del saldo. El pago y su evento `PaymentReceived` se guardan en UNA transacción. Solo las facturas emitidas reciben pagos.
 */
export class RegisterPaymentUseCase {
  constructor(private readonly uow: PaymentUnitOfWork, private readonly clock: () => Date = () => new Date()) {}

  async execute(number: string, raw: { amountCop: unknown; method: unknown; reference?: unknown }, registeredBy: string, correlationId: string) {
    const input = validatePayment(raw);
    return this.uow.run(async (tx) => {
      const found = await tx.lockInvoice(number);
      if (!found) throw new InvoiceNotFoundError(number);
      if (found.invoice.status !== 'issued') throw new PaymentNotAllowedError(number);
      const balance = balanceOf(found.invoice.totalCop, found.paidCop);
      if (input.amountCop > balance) throw new OverpaymentError(balance);
      const now = this.clock();
      const payment: Payment = { id: randomUUID(), invoiceNumber: number, paidAt: now, registeredBy, ...input };
      const paidCop = found.paidCop + input.amountCop;
      await tx.insertPayment(payment);
      await tx.addToOutbox(paymentReceived(found.invoice, payment, paidCop, correlationId, now));
      return { payment, paidCop, balanceCop: balanceOf(found.invoice.totalCop, paidCop), status: paymentStatusOf(found.invoice.totalCop, paidCop) };
    });
  }
}

export class ListPaymentsUseCase {
  constructor(private readonly queries: PaymentQueries) {}
  async execute(number: string): Promise<Payment[]> {
    const list = await this.queries.listForInvoice(number);
    if (list === null) throw new InvoiceNotFoundError(number);
    return list;
  }
}
