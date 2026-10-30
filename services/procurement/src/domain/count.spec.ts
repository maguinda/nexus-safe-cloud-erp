import { ConflictError, ValidationError } from './errors';
import { planClose, validateCounted } from './count';

describe('validateCounted', () => {
  it('accepts whole numbers from 0 to 1.000.000', () => { for (const v of [0, 1, 999, 1_000_000]) expect(validateCounted(v)).toBe(v); });
  it.each([-1, 1.5, 1_000_001, '5', null, undefined, NaN, Infinity, {}, []])('refuses %p', (v) => { expect(() => validateCounted(v)).toThrow(ValidationError); });
});

describe('planClose', () => {
  const L = (itemId: string, expected: number, counted: number | null) => ({ itemId, itemName: `Item ${itemId}`, expected, counted });
  it('applies counted − expected on top of the CURRENT stock (movements after opening are kept)', () => {
    // esperado 8, se recibieron 5 después (ahora 13), se contó 6 → faltan 2 → queda en 11
    expect(planClose([L('a', 8, 6)], new Map([['a', 13]]))).toEqual([{ itemId: 'a', itemName: 'Item a', delta: -2, onHandAfter: 11 }]);
  });
  it('skips uncounted lines and lines with no difference; orders by item id', () => {
    const r = planClose([L('c', 5, 7), L('a', 3, 3), L('b', 4, null), L('d', 1, 0)], new Map([['a', 3], ['b', 4], ['c', 5], ['d', 1]]));
    expect(r.map((x) => [x.itemId, x.delta, x.onHandAfter])).toEqual([['c', 2, 7], ['d', -1, 0]]);
  });
  it('refuses the WHOLE close if any item would end below zero, and says which', () => {
    expect(() => planClose([L('a', 10, 12), L('b', 10, 0)], new Map([['a', 10], ['b', 4]]))).toThrow(/Item b has 4 in stock now: the count would leave it at -6/);
  });
  it('refuses an item that no longer exists', () => { expect(() => planClose([L('a', 1, 2)], new Map())).toThrow(ConflictError); });
  it('an empty or fully uncounted count plans nothing', () => { expect(planClose([], new Map())).toEqual([]); expect(planClose([L('a', 1, null)], new Map([['a', 1]]))).toEqual([]); });
});
