import { InvalidEventError } from '../domain/errors';
import { HandleQuoteApprovedUseCase } from './handle-quote-approved.use-case';

const ev = (at = '2026-11-02T15:00:00.000Z') => ({ eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01', type: 'QuoteApproved', occurredAt: at, correlationId: 'corr-12345678',
  data: { quoteId: '11111111-1111-4111-8111-111111111111', quoteNumber: 'COT-0001', clientName: 'Acme', projectId: 'p-1', projectName: 'Red', amountCop: 100, approvedBy: 'a@b.co' } });

describe('HandleQuoteApprovedUseCase', () => {
  it('gives the contract 365 days from the approval day (UTC), including across a leap year', async () => {
    const calls: string[][] = []; const uc = new HandleQuoteApprovedUseCase({ createContractFromQuote: async (_e, s, e) => { calls.push([s, e]); return 'created'; } });
    await uc.execute(ev()); await uc.execute(ev('2027-03-01T23:59:59.000Z')); await uc.execute(ev('2027-12-31T23:30:00.000Z'));
    expect(calls).toEqual([['2026-11-02', '2027-11-02'], ['2027-03-01', '2028-02-29'], ['2027-12-31', '2028-12-30']]);
  });
  it('refuses an invalid event without touching the store', async () => {
    let touched = 0; const uc = new HandleQuoteApprovedUseCase({ createContractFromQuote: async () => { touched++; return 'created'; } });
    await expect(uc.execute({ ...ev(), type: 'x' })).rejects.toBeInstanceOf(InvalidEventError); expect(touched).toBe(0);
  });
});
