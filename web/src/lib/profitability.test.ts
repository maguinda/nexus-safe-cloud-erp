import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkSalary, dailyFromSalary } from './profitability';

const t = makeT('en');
describe('checkSalary (same rules as the server)', () => {
  it('accepts whole pesos from 1 to 200.000.000, and empty clears the salary', () => {
    expect(checkSalary(t, ' 9900000 ').value).toBe(9_900_000); expect(checkSalary(t, '1').value).toBe(1); expect(checkSalary(t, '200000000').value).toBe(200_000_000);
    expect(checkSalary(t, '').value).toBeNull(); expect(checkSalary(t, '   ').value).toBeNull();
  });
  it.each(['0', '-5', '1.5', '1,000', 'abc', '200000001', '1e3', '٣'])('rejects %p', (v) => { expect(checkSalary(t, v).error).toBeTruthy(); });
});

describe('dailyFromSalary (same as the server: salary / 22, half up)', () => {
  it.each([[9_900_000, 450_000], [5_000_000, 227_273], [200_000_000, 9_090_909], [22, 1], [11, 1], [10, 0]])('%p → %p', (s, d) => { expect(dailyFromSalary(s)).toBe(d); });
});
