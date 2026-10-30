import { InvalidPaymentError } from './errors';

export const PAYMENT_METHODS = ['transfer', 'cash', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const MAX_REFERENCE = 60;

export interface PaymentInput { amountCop: number; method: PaymentMethod; reference: string | null }
export interface Payment extends PaymentInput { id: string; invoiceNumber: string; paidAt: Date; registeredBy: string }

// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u001f<>]/;

/** Un pago: pesos enteros mayores que 0, un medio de la lista y una referencia opcional corta y sin caracteres raros. El tope contra el saldo lo pone el caso de uso (dentro del bloqueo). */
export function validatePayment(raw: { amountCop: unknown; method: unknown; reference?: unknown }): PaymentInput {
  if (typeof raw.amountCop !== 'number' || !Number.isInteger(raw.amountCop) || raw.amountCop < 1 || raw.amountCop > 2_147_483_647) throw new InvalidPaymentError('amountCop must be a whole number of pesos greater than 0');
  if (typeof raw.method !== 'string' || !(PAYMENT_METHODS as readonly string[]).includes(raw.method)) throw new InvalidPaymentError(`method must be one of: ${PAYMENT_METHODS.join(', ')}`);
  let reference: string | null = null;
  if (raw.reference !== undefined && raw.reference !== null && raw.reference !== '') {
    if (typeof raw.reference !== 'string') throw new InvalidPaymentError('reference must be text');
    const r = raw.reference.trim().replace(/\s+/g, ' ');
    if (r.length > MAX_REFERENCE || BAD.test(r)) throw new InvalidPaymentError(`reference must be up to ${MAX_REFERENCE} characters without < > or control characters`);
    reference = r || null;
  }
  return { amountCop: raw.amountCop, method: raw.method as PaymentMethod, reference };
}

export const balanceOf = (totalCop: number, paidCop: number): number => totalCop - paidCop;
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export const paymentStatusOf = (totalCop: number, paidCop: number): PaymentStatus => (paidCop <= 0 ? 'unpaid' : paidCop >= totalCop ? 'paid' : 'partial');
