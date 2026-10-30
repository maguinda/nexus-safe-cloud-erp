import { parseQuoteApproved, QuoteApprovedEvent } from '../domain/quote-approved';

export type QuoteHandleResult = 'created' | 'duplicate';
export interface QuoteContractStore {
  /** En una transacción: anota el eventId y crea el contrato; 'duplicate' si el evento o la cotización ya se procesaron. */
  createContractFromQuote(e: QuoteApprovedEvent, startDate: string, endDate: string): Promise<QuoteHandleResult>;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Gerencia aprobó una cotización: nace el contrato del proyecto con el PRECIO de la cotización, ligado por id al proyecto.
 * Idempotente (RabbitMQ entrega «al menos una vez»). Las fechas no vienen en la cotización: vigencia por defecto de 365 días desde la aprobación.
 */
export class HandleQuoteApprovedUseCase {
  constructor(private readonly store: QuoteContractStore) {}
  async execute(raw: unknown): Promise<QuoteHandleResult> {
    const e = parseQuoteApproved(raw);
    const start = new Date(e.occurredAt).toISOString().slice(0, 10);
    return this.store.createContractFromQuote(e, start, addDays(start, 365));
  }
}
