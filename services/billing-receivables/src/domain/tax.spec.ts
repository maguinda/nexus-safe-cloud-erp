import { computeTotals, MAX_SUBTOTAL_COP } from './tax';

describe('computeTotals (IVA 19 %, whole pesos)', () => {
  it.each([
    [1_000, 190, 1_190],
    [18_500_000, 3_515_000, 22_015_000],
    [12_000_000, 2_280_000, 14_280_000],
    [9_800_000, 1_862_000, 11_662_000],
    [MAX_SUBTOTAL_COP, 190_000_000, 1_190_000_000],
  ])('subtotal %i gives tax %i and total %i', (sub, tax, total) => {
    expect(computeTotals(sub)).toEqual({ subtotalCop: sub, taxCop: tax, totalCop: total });
  });

  it.each([
    [1, 0],      // 0,19 baja
    [2, 0],      // 0,38 baja
    [3, 1],      // 0,57 sube
    [50, 10],    // 9,5: la mitad sube
    [150, 29],   // 28,5: la mitad sube
    [2_650, 504] // 503,5: la mitad sube
  ])('rounds to the nearest peso, halves up: subtotal %i -> tax %i', (sub, tax) => {
    expect(computeTotals(sub).taxCop).toBe(tax);
  });

  it('keeps total = subtotal + tax and tax within half a peso of 19 % for many values', () => {
    for (let i = 0; i < 5000; i++) {
      const sub = 1 + Math.floor(Math.random() * MAX_SUBTOTAL_COP);
      const t = computeTotals(sub);
      expect(t.totalCop).toBe(sub + t.taxCop);
      expect(Math.abs(t.taxCop - sub * 0.19)).toBeLessThanOrEqual(0.5000001);
      expect(Number.isSafeInteger(t.totalCop) && t.totalCop <= 2_147_483_647).toBe(true); // cabe en un Int de PostgreSQL
    }
  });

  it.each([[0], [-5], [10.5], [Number.NaN], [Infinity], [MAX_SUBTOTAL_COP + 1], [9e15]])('rejects the invalid subtotal %p', (bad) => {
    expect(() => computeTotals(bad as number)).toThrow(RangeError);
  });
});
