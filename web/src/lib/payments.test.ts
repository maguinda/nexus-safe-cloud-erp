import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkPayment } from './payments';

const t = makeT('en');
const ok = { amount: '500000', method: 'transfer', reference: '' };
describe('checkPayment (same rules as the server)', () => {
  it('accepts a valid payment up to the balance', () => {
    expect(checkPayment(t, ok, 1_190_000).value).toEqual({ amountCop: 500_000, method: 'transfer' });
    expect(checkPayment(t, { ...ok, amount: '1190000', reference: ' Bank   transfer 8841 ' }, 1_190_000).value).toEqual({ amountCop: 1_190_000, method: 'transfer', reference: 'Bank transfer 8841' });
  });
  it.each(['0', '-5', '1.5', '1,000', 'abc', '', ' ', '1e3'])('rejects the amount %p', (amount) => { expect(checkPayment(t, { ...ok, amount }, 1_190_000).errors.amount).toBeTruthy(); });
  it('rejects an amount over the balance and says the balance', () => { expect(checkPayment(t, { ...ok, amount: '1190001' }, 1_190_000).errors.amount).toContain('1.190.000'); });
  it('rejects a missing or unknown method', () => { for (const method of ['', 'wire', 'TRANSFER']) expect(checkPayment(t, { ...ok, method }, 1_190_000).errors.method).toBeTruthy(); });
  it('rejects a long, marked-up or control-character reference', () => { for (const reference of ['x'.repeat(61), '<b>x</b>', 'a\u0000b']) expect(checkPayment(t, { ...ok, reference }, 1_190_000).errors.reference).toBeTruthy(); });
});
