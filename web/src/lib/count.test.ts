import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkCounted } from './count';

const t = makeT('en');
describe('checkCounted (same rule as the server)', () => {
  it('accepts 0 to 1.000.000 and trims', () => { for (const [s, n] of [['0', 0], [' 7 ', 7], ['1000000', 1_000_000]] as const) expect(checkCounted(t, s).value).toBe(n); });
  it.each(['', ' ', '-1', '1.5', '1,000', 'abc', '1000001', '12345678', '1e3'])('rejects %p', (v) => { expect(checkCounted(t, v).error).toBeTruthy(); });
});
