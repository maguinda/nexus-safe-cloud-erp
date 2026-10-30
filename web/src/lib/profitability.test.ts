import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkDailyCost } from './profitability';

const t = makeT('en');
describe('checkDailyCost (same rules as the server)', () => {
  it('accepts whole pesos from 1 to 50.000.000, and empty clears the cost', () => {
    expect(checkDailyCost(t, ' 450000 ').value).toBe(450000); expect(checkDailyCost(t, '1').value).toBe(1); expect(checkDailyCost(t, '50000000').value).toBe(50_000_000);
    expect(checkDailyCost(t, '').value).toBeNull(); expect(checkDailyCost(t, '   ').value).toBeNull();
  });
  it.each(['0', '-5', '1.5', '1,000', 'abc', '50000001', '1e3', '٣'])('rejects %p', (v) => { expect(checkDailyCost(t, v).error).toBeTruthy(); });
});
