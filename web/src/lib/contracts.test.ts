import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkContract } from './contracts';

const t = makeT('en');
const ok = { clientName: ' Retail   Norte ', projectName: 'Branch network upgrade', amountCop: '120000000', startDate: '2026-11-01', endDate: '2027-05-01' };
describe('checkContract (same rules as the server)', () => {
  it('accepts a valid contract and cleans the names', () => { expect(checkContract(t, ok).value).toEqual({ ...ok, clientName: 'Retail Norte', amountCop: 120_000_000 }); });
  it('accepts a one-day contract', () => { expect(checkContract(t, { ...ok, endDate: '2026-11-01' }).value).toBeTruthy(); });
  it.each([['clientName', 'A'], ['clientName', '<b>x</b>'], ['projectName', ''], ['projectName', 'x'.repeat(121)], ['amountCop', '0'], ['amountCop', '1.5'], ['amountCop', '1,000'], ['amountCop', '2147483648'], ['startDate', '2026-02-30'], ['endDate', ''], ['endDate', '2026-10-31']])('rejects %s = %p', (k, v) => {
    expect(checkContract(t, { ...ok, [k]: v } as any).errors[k as 'clientName']).toBeTruthy();
  });
});
