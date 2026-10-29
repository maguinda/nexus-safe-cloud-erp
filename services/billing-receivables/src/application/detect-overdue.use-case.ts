import { randomUUID } from 'crypto';
import { invoiceOverdue } from '../domain/events';
import { daysOverdue, utcDateString } from '../domain/overdue';
import { OverdueUnitOfWork } from '../domain/ports';

/** Cuántas facturas se procesan por pasada: si hay más, la siguiente pasada sigue con las que quedaron. */
export const OVERDUE_BATCH = 200;

/**
 * Publica `InvoiceOverdue` UNA vez por cada factura emitida cuyo vencimiento ya pasó. Todo en una transacción: la factura se bloquea (SKIP LOCKED), se escribe su evento
 * en el outbox y listo; si algo falla no queda nada. Idempotente: una factura con su evento ya no vuelve a salir (la consulta la excluye y la base tiene único por factura y tipo).
 * El reloj es UNO solo por pasada (la fecha de hoy y el momento del evento salen de la misma lectura).
 */
export class DetectOverdueInvoicesUseCase {
  constructor(private readonly uow: OverdueUnitOfWork, private readonly clock: () => Date = () => new Date()) {}

  execute(): Promise<{ detected: number }> {
    const now = this.clock();
    const correlationId = `overdue-${utcDateString(now).replace(/-/g, '')}-${randomUUID().slice(0, 8)}`;
    return this.uow.run(async (tx) => {
      const invoices = await tx.findNewlyOverdue(utcDateString(now), OVERDUE_BATCH);
      let detected = 0;
      for (const i of invoices) {
        const days = daysOverdue(i, now);
        if (days === 0) continue; // defensa: la consulta ya filtra, pero el dominio manda
        if (await tx.addToOutbox(invoiceOverdue(i, days, correlationId, now))) detected++;
      }
      return { detected };
    });
  }
}
