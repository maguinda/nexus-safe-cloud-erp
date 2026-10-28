import { describe, expect, it } from 'vitest';
import { pageOf } from './paging';

describe('pageOf', () => {
  const many = Array.from({ length: 60 }, (_, i) => i);
  it('devuelve la primera tanda y lo que queda', () => expect(pageOf(many, 25)).toEqual({ rows: many.slice(0, 25), hidden: 35 }));
  it('si caben todas no queda nada oculto', () => expect(pageOf([1, 2], 25)).toEqual({ rows: [1, 2], hidden: 0 }));
  it('valores raros no rompen', () => { expect(pageOf(many, -3)).toEqual({ rows: [], hidden: 60 }); expect(pageOf(many, 2.9).rows).toEqual([0, 1]); });
  it('no modifica la lista original', () => { const copy = [...many]; pageOf(many, 5); expect(many).toEqual(copy); });
});
