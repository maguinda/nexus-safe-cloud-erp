import type { MsgKey, TFn } from '../i18n';

export const METHODS = ['transfer', 'cash', 'card', 'other'] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_KEY: Record<Method, MsgKey> = { transfer: 'pay.method.transfer', cash: 'pay.method.cash', card: 'pay.method.card', other: 'pay.method.other' };
export const REFERENCE_MAX = 60;
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u001f<>]/;

export interface PaymentErrors { amount?: string; method?: string; reference?: string }

/** Mismos criterios que el servidor: pesos enteros de 1 al saldo, un medio de la lista y una referencia corta sin < > ni caracteres de control. */
export function checkPayment(t: TFn, f: { amount: string; method: string; reference: string }, balanceCop: number): { errors: PaymentErrors; value?: { amountCop: number; method: Method; reference?: string } } {
  const errors: PaymentErrors = {};
  const a = f.amount.trim();
  if (!/^\d+$/.test(a) || Number(a) < 1) errors.amount = t('pay.v.amount');
  else if (Number(a) > balanceCop) errors.amount = t('pay.v.balance', { balance: balanceCop.toLocaleString('es-CO') });
  if (!(METHODS as readonly string[]).includes(f.method)) errors.method = t('pay.v.method');
  const r = f.reference.replace(/\s+/g, ' ').trim();
  if (r.length > REFERENCE_MAX || BAD.test(f.reference.replace(/\s/g, ' '))) errors.reference = t('pay.v.reference', { max: REFERENCE_MAX });
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { amountCop: Number(a), method: f.method as Method, ...(r ? { reference: r } : {}) } };
}
