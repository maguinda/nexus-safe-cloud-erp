import { InvalidPaymentError } from './errors';
import { balanceOf, MAX_REFERENCE, paymentStatusOf, validatePayment } from './payment';

describe('validatePayment', () => {
  it('accepts a normal payment and cleans the reference', () => {
    expect(validatePayment({ amountCop: 5_000_000, method: 'transfer', reference: '  Bank   transfer 8841 ' })).toEqual({ amountCop: 5_000_000, method: 'transfer', reference: 'Bank transfer 8841' });
  });
  it('the reference is optional (missing, null or empty)', () => { for (const r of [undefined, null, '', '   ']) expect(validatePayment({ amountCop: 1, method: 'cash', reference: r }).reference).toBeNull(); });
  it.each([0, -1, 1.5, '100', null, undefined, NaN, Infinity, 2_147_483_648])('rejects an amount of %p', (a) => { expect(() => validatePayment({ amountCop: a, method: 'cash' })).toThrow(InvalidPaymentError); });
  it.each(['wire', '', 'TRANSFER', null, 5])('rejects the method %p', (m) => { expect(() => validatePayment({ amountCop: 1, method: m })).toThrow(InvalidPaymentError); });
  it('rejects a reference that is too long, has markup or control characters or is not text', () => {
    for (const r of ['x'.repeat(MAX_REFERENCE + 1), '<b>x</b>', 'a\u0000b', 7]) expect(() => validatePayment({ amountCop: 1, method: 'card', reference: r })).toThrow(InvalidPaymentError);
    expect(() => validatePayment({ amountCop: 1, method: 'card', reference: 'x'.repeat(MAX_REFERENCE) })).not.toThrow();
  });
});

describe('balance and status', () => {
  it('balance is total minus paid', () => { expect(balanceOf(1_190_000, 190_000)).toBe(1_000_000); });
  it.each([[100, 0, 'unpaid'], [100, 1, 'partial'], [100, 99, 'partial'], [100, 100, 'paid']] as const)('total %p paid %p → %p', (t, p, s) => { expect(paymentStatusOf(t, p)).toBe(s); });
});
