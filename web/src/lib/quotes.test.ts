import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkQuote, EditQuote, preview, priceOf } from './quotes';

const t = makeT('en');
const line = (o: object = {}) => ({ category: 'materials' as const, description: 'Switch de acceso 24 puertos', quantity: '2', unit: '1000000', ref: null, ...o });
const q = (o: Partial<EditQuote> = {}): EditQuote => ({ client: 'Acme S.A.S.', projectName: 'Red sede Bogotá', margin: '25', milestones: [{ name: 'Diseño', lines: [line()] }], ...o });

describe('priceOf (same vectors as the server)', () => {
  it.each([[1_000_000, 25, 1_250_000], [1_000_000, 0, 1_000_000], [1_000_000, 100, 2_000_000], [3, 25, 4], [2, 25, 3], [1, 25, 1], [10, 25, 13], [0, 25, 0], [999_999_999, 25, 1_249_999_999]])('%p at %p%% → %p', (c, m, p) => { expect(priceOf(c, m)).toBe(p); });
});

describe('preview', () => {
  it('adds quantity × unit cost per milestone and the price is the sum of the milestone prices', () => {
    const p = preview(q({ milestones: [{ name: 'Hito A', lines: [line({ quantity: '5', unit: '227273' }), line({ quantity: '10', unit: '3333' })] }, { name: 'Hito B', lines: [line({ quantity: '3', unit: '2000001' })] }] }));
    expect(p.milestones.map((m) => m.cost)).toEqual([1_169_695, 6_000_003]); expect(p.price).toBe(priceOf(1_169_695, 25) + priceOf(6_000_003, 25)); expect(p.profit).toBe(p.price - p.cost);
  });
  it('counts invalid numbers as zero and a missing margin as 25', () => { expect(preview(q({ margin: '', milestones: [{ name: 'Hito A', lines: [line({ quantity: 'x' }), line({ unit: '2.5' })] }] })).cost).toBe(0); expect(preview(q({ margin: 'abc' })).price).toBe(priceOf(2_000_000, 25)); });
});

describe('checkQuote (same rules as the server)', () => {
  it('accepts a good quote and cleans the texts', () => {
    const r = checkQuote(t, q({ client: '  Acme   S.A.S. ', milestones: [{ name: ' Diseño ', lines: [line({ description: ' x  y ', ref: 'proc:1' })] }] }), true);
    expect(r.errors).toEqual([]); expect(r.value).toEqual({ client: 'Acme S.A.S.', projectName: 'Red sede Bogotá', marginPct: 25, milestones: [{ name: 'Diseño', lines: [{ category: 'materials', description: 'x y', quantity: 2, unitCostCop: 1_000_000, ref: 'proc:1' }] }] });
  });
  it.each<[string, Partial<EditQuote>]>([
    ['client short', { client: 'A' }], ['client markup', { client: '<b>x</b>' }], ['project empty', { projectName: ' ' }], ['margin 101', { margin: '101' }], ['margin text', { margin: 'x' }], ['margin decimal', { margin: '12.5' }], ['margin empty', { margin: '' }],
    ['milestone without name', { milestones: [{ name: '', lines: [line()] }] }], ['milestone repeated', { milestones: [{ name: 'Hito A', lines: [line()] }, { name: ' hito a ', lines: [line()] }] }],
    ['description short', { milestones: [{ name: 'Hito A', lines: [line({ description: 'x' })] }] }], ['quantity 0', { milestones: [{ name: 'Hito A', lines: [line({ quantity: '0' })] }] }], ['quantity big', { milestones: [{ name: 'Hito A', lines: [line({ quantity: '100001' })] }] }], ['quantity decimal', { milestones: [{ name: 'Hito A', lines: [line({ quantity: '1.5' })] }] }],
    ['unit 0', { milestones: [{ name: 'Hito A', lines: [line({ unit: '0' })] }] }], ['unit huge', { milestones: [{ name: 'Hito A', lines: [line({ unit: '1000000001' })] }] }], ['unit text', { milestones: [{ name: 'Hito A', lines: [line({ unit: '1,000' })] }] }],
    ['milestone price over 1.000 millones', { milestones: [{ name: 'Hito A', lines: [line({ quantity: '1000', unit: '1000000' })] }] }],
    ['quote price over 2.000 millones', { milestones: ['Hito A', 'Hito B', 'Hito C'].map((n) => ({ name: n, lines: [line({ quantity: '700', unit: '1000000' })] })) }],
  ])('refuses %s with a visible warning and no value', (_n, over) => { const r = checkQuote(t, q(over), false); expect(r.value).toBeUndefined(); expect(r.errors.length).toBeGreaterThan(0); });
  it('sending needs a milestone and a line in each; saving a draft does not', () => {
    expect(checkQuote(t, q({ milestones: [] }), true).errors).toHaveLength(1); expect(checkQuote(t, q({ milestones: [{ name: 'Hito A', lines: [] }] }), true).errors).toHaveLength(1);
    expect(checkQuote(t, q({ milestones: [] }), false).value).toBeDefined(); expect(checkQuote(t, q({ milestones: [{ name: 'Hito A', lines: [] }] }), false).value).toBeDefined();
  });
});
