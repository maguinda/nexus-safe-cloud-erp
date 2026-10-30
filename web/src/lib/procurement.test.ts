import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkAdjust, checkName, checkOrder, parseKinds } from './procurement';

const t = makeT('en');
const ids = { supplierId: 's', itemId: 'i' };
describe('parseKinds', () => { it('upper-cases, trims and drops repeats', () => { expect(parseKinds(' temp, Humidity ,TEMP,, ')).toEqual(['TEMP', 'HUMIDITY']); expect(parseKinds('')).toEqual([]); }); });
describe('checkName', () => {
  it.each([['A', 'short'], ['<b>x</b>', 'chars'], ['x'.repeat(81), 'long']])('rejects %p', (v) => { expect(checkName(t, v, 'proc.field.name', 2, 80)).not.toBe(''); });
  it('accepts a normal name', () => { expect(checkName(t, 'Redes del Norte', 'proc.field.name', 2, 80)).toBe(''); });
});
describe('checkOrder (same rules as the server)', () => {
  it('accepts a valid order', () => { expect(checkOrder(t, { ...ids, quantity: '5', price: '100000' }).value).toEqual({ supplierId: 's', itemId: 'i', quantity: 5, unitPriceCop: 100_000 }); });
  it.each(['0', '100001', '1.5', '-3', 'abc', ''])('rejects quantity %p', (quantity) => { expect(checkOrder(t, { ...ids, quantity, price: '1000' }).errors.quantity).toBeTruthy(); });
  it.each(['0', '1000000001', '1,5', ''])('rejects price %p', (price) => { expect(checkOrder(t, { ...ids, quantity: '1', price }).errors.price).toBeTruthy(); });
  it('rejects a total over 2.000.000.000 and an unchosen supplier or item', () => {
    expect(checkOrder(t, { ...ids, quantity: '100000', price: '100000' }).errors.price).toBeTruthy();
    const e = checkOrder(t, { supplierId: '', itemId: '', quantity: '1', price: '1' }).errors; expect(e.supplier && e.item).toBeTruthy();
  });
});
describe('checkAdjust', () => {
  it('accepts + and − (also the typographic minus)', () => { expect(checkAdjust(t, { delta: '+3', reason: 'Stock count' }).value).toEqual({ delta: 3, reason: 'Stock count' }); expect(checkAdjust(t, { delta: '−2', reason: 'Used' }).value?.delta).toBe(-2); });
  it.each(['0', '1.5', '100001', 'x', ''])('rejects delta %p', (delta) => { expect(checkAdjust(t, { delta, reason: 'Stock count' }).errors.delta).toBeTruthy(); });
  it.each(['ab', '', '<x>y', 'x'.repeat(121)])('rejects reason %p', (reason) => { expect(checkAdjust(t, { delta: '1', reason }).errors.reason).toBeTruthy(); });
});
