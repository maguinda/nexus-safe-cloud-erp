import { InvalidInputError, QuoteStateError } from './errors';
import { assertReadyToSubmit, DEFAULT_MARGIN_PCT, priceOf, priceQuote, quoteLabel, validateQuoteContent } from './quote';

const line = (o: object = {}) => ({ category: 'materials', description: 'Switch de acceso 24 puertos', quantity: 2, unitCostCop: 1_000_000, ...o });
const ok = (o: object = {}) => ({ client: 'Acme S.A.S.', projectName: 'Red sede Bogotá', milestones: [{ name: 'Diseño', lines: [line()] }], ...o });

describe('priceOf: cost plus margin, rounded half up in whole pesos', () => {
  it.each([[1_000_000, 25, 1_250_000], [1_000_000, 0, 1_000_000], [1_000_000, 100, 2_000_000], [3, 25, 4], [2, 25, 3], [1, 25, 1], [10, 25, 13], [0, 25, 0], [999_999_999, 25, 1_249_999_999]])('%p at %p%% → %p', (c, m, p) => { expect(priceOf(c, m)).toBe(p); });
});

describe('priceQuote', () => {
  it('adds materials, supplies and labor per milestone and for the whole quote; the project price is the sum of the milestone prices', () => {
    const q = priceQuote(validateQuoteContent(ok({ milestones: [
      { name: 'Diseño', lines: [line({ category: 'labor', description: 'Ingeniero de redes', quantity: 5, unitCostCop: 227_273 }), line({ category: 'supplies', quantity: 10, unitCostCop: 3_333 })] },
      { name: 'Instalación', lines: [line({ quantity: 3, unitCostCop: 2_000_001 })] },
    ] })));
    expect(q.milestones[0]).toMatchObject({ costCop: 1_136_365 + 33_330, byCategory: { labor: 1_136_365, supplies: 33_330, materials: 0 } });
    expect(q.milestones[1].costCop).toBe(6_000_003);
    expect(q.byCategory).toEqual({ materials: 6_000_003, supplies: 33_330, labor: 1_136_365 });
    expect(q.priceCop).toBe(q.milestones[0].priceCop + q.milestones[1].priceCop); // los hitos suman EXACTO el contrato
    expect(q.profitCop).toBe(q.priceCop - q.costCop); expect(q.marginPct).toBe(DEFAULT_MARGIN_PCT); expect(q.lowMargin).toBe(false);
  });
  it('flags a margin below 10 %', () => { expect(priceQuote(validateQuoteContent(ok({ marginPct: 9 }))).lowMargin).toBe(true); expect(priceQuote(validateQuoteContent(ok({ marginPct: 10 }))).lowMargin).toBe(false); });
  it('refuses a milestone over 1.000 millones and a quote over 2.000 millones', () => {
    expect(() => validateQuoteContent(ok({ milestones: [{ name: 'A', lines: [line({ quantity: 1000, unitCostCop: 1_000_000 })] }] }))).toThrow(InvalidInputError);
    const big = (n: string) => ({ name: n, lines: [line({ quantity: 700, unitCostCop: 1_000_000 })] }); // 700 millones de costo → 875 de precio
    expect(() => validateQuoteContent(ok({ milestones: [big('A'), big('B'), big('C')] }))).toThrow(InvalidInputError);
  });
});

describe('validateQuoteContent', () => {
  it('cleans the texts, defaults the margin to 25 and the milestones to none', () => {
    expect(validateQuoteContent({ client: '  Acme   S.A.S. ', projectName: ' Red ' })).toEqual({ client: 'Acme S.A.S.', projectName: 'Red', marginPct: 25, milestones: [] });
    expect(validateQuoteContent(ok({ milestones: [{ name: ' Diseño ', lines: [line({ ref: ' proc:switch ', description: ' x  y ' })] }] })).milestones[0].lines[0]).toMatchObject({ ref: 'proc:switch', description: 'x y' });
  });
  it.each<[string, object]>([
    ['no client', { client: '' }], ['client number', { client: 5 }], ['client html', { client: '<b>x</b>' }], ['margin negative', { marginPct: -1 }], ['margin 101', { marginPct: 101 }], ['margin text', { marginPct: '25' }], ['margin decimal', { marginPct: 12.5 }],
    ['milestones not a list', { milestones: {} }], ['31 milestones', { milestones: Array.from({ length: 31 }, (_, i) => ({ name: `H${i}`, lines: [] })) }],
    ['milestone repeated', { milestones: [{ name: 'A', lines: [] }, { name: ' a ', lines: [] }] }], ['milestone no name', { milestones: [{ name: '', lines: [] }] }], ['milestone null', { milestones: [null] }],
    ['41 lines', { milestones: [{ name: 'A', lines: Array.from({ length: 41 }, () => line()) }] }],
    ['category unknown', { milestones: [{ name: 'A', lines: [line({ category: 'beer' })] }] }], ['category proto', { milestones: [{ name: 'A', lines: [line({ category: 'toString' })] }] }],
    ['quantity 0', { milestones: [{ name: 'A', lines: [line({ quantity: 0 })] }] }], ['quantity big', { milestones: [{ name: 'A', lines: [line({ quantity: 100_001 })] }] }], ['quantity decimal', { milestones: [{ name: 'A', lines: [line({ quantity: 1.5 })] }] }],
    ['unit 0', { milestones: [{ name: 'A', lines: [line({ unitCostCop: 0 })] }] }], ['unit negative', { milestones: [{ name: 'A', lines: [line({ unitCostCop: -5 })] }] }], ['unit text', { milestones: [{ name: 'A', lines: [line({ unitCostCop: '5' })] }] }], ['unit huge', { milestones: [{ name: 'A', lines: [line({ unitCostCop: 1_000_000_001 })] }] }],
    ['description empty', { milestones: [{ name: 'A', lines: [line({ description: ' ' })] }] }], ['description markup', { milestones: [{ name: 'A', lines: [line({ description: '<script>' })] }] }],
  ])('refuses %s', (_n, over) => { expect(() => validateQuoteContent(ok(over))).toThrow(InvalidInputError); });
});

describe('assertReadyToSubmit and labels', () => {
  it('needs a milestone and a line in each milestone', () => {
    expect(() => assertReadyToSubmit(validateQuoteContent(ok({ milestones: [] })))).toThrow(QuoteStateError);
    expect(() => assertReadyToSubmit(validateQuoteContent(ok({ milestones: [{ name: 'A', lines: [] }] })))).toThrow(QuoteStateError);
    expect(() => assertReadyToSubmit(validateQuoteContent(ok()))).not.toThrow();
  });
  it('labels the quote number', () => { expect(quoteLabel(7)).toBe('COT-0007'); expect(quoteLabel(12345)).toBe('COT-12345'); });
});
