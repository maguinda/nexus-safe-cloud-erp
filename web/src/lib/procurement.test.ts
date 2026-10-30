import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkCatalog, checkTender, checkAdjust, checkName, checkOrder, parseKinds } from './procurement';

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
  it.each(['0', '1000000001', '1,5', 'abc'])('rejects price %p', (price) => { expect(checkOrder(t, { ...ids, quantity: '1', price }).errors.price).toBeTruthy(); });
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

describe('order price is optional, catalog and tender checks', () => {
  const ids = { supplierId: 's', itemId: 'i' };
  it('an empty price means the supplier reference price (no unitPriceCop is sent)', () => { expect(checkOrder(t, { ...ids, quantity: '2', price: '  ' }).value).toEqual({ supplierId: 's', itemId: 'i', quantity: 2 }); });
  it('checkCatalog accepts price and 0 to 365 days and refuses the rest', () => {
    expect(checkCatalog(t, { price: ' 2400000 ', days: '5' }).value).toEqual({ refPriceCop: 2_400_000, leadDays: 5 }); expect(checkCatalog(t, { price: '1', days: '0' }).value).toBeTruthy(); expect(checkCatalog(t, { price: '1', days: '365' }).value).toBeTruthy();
    for (const price of ['0', '1,5', '1000000001', '', 'x']) expect(checkCatalog(t, { price, days: '3' }).errors.price).toBeTruthy();
    for (const days of ['', '-1', '366', '1.5', 'x', '1000']) expect(checkCatalog(t, { price: '5', days }).errors.days).toBeTruthy();
  });
  it('checkTender: both optional, reference 2 to 40 clean characters, real end date', () => {
    expect(checkTender(t, { ref: '', until: '' }).value).toEqual({}); expect(checkTender(t, { ref: ' LIC-2027-001 ', until: '2027-12-31' }).value).toEqual({ tenderRef: 'LIC-2027-001', validUntil: '2027-12-31' });
    for (const ref of ['a', '<b>x</b>', 'x'.repeat(41)]) expect(checkTender(t, { ref, until: '' }).errors.ref).toBeTruthy();
    for (const until of ['2027-02-30', 'mañana', '1999-01-01', '2101-01-01']) expect(checkTender(t, { ref: '', until }).errors.until).toBeTruthy();
  });
});
