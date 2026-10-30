import { InvalidEventError } from './errors';
import { parseQuoteApproved } from './quote-approved';

const ev = (data: object = {}, over: object = {}) => ({ eventId: '0B8F2C1E-5D4A-4E7B-9A63-1C2D3E4F5A01', type: 'QuoteApproved', occurredAt: '2026-11-02T15:00:00.000Z', correlationId: 'corr-12345678',
  data: { quoteId: '11111111-1111-4111-8111-111111111111', quoteNumber: 'COT-0001', clientName: '  Acme   S.A.S. ', projectId: 'p-ab12cd34', projectName: 'Red sede Bogotá', amountCop: 12_500_000, approvedBy: 'diana.vega@nexus.example', extra: 'ignored', ...data }, ...over });

describe('parseQuoteApproved', () => {
  it('accepts a complete event, cleans the names, lowercases the ids and ignores extra fields', () => {
    const p = parseQuoteApproved(ev());
    expect(p.eventId).toBe('0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01'); expect(p.data).toEqual({ quoteId: '11111111-1111-4111-8111-111111111111', quoteNumber: 'COT-0001', clientName: 'Acme S.A.S.', projectId: 'p-ab12cd34', projectName: 'Red sede Bogotá', amountCop: 12_500_000, approvedBy: 'diana.vega@nexus.example' });
    expect(parseQuoteApproved(ev({ amountCop: 2_147_483_647 })).data.amountCop).toBe(2_147_483_647); expect(parseQuoteApproved(ev({ amountCop: 1 })).data.amountCop).toBe(1);
  });
  it.each<[string, unknown]>([
    ['null', null], ['array', []], ['text', 'x'], ['other type', ev({}, { type: 'MilestoneApproved' })], ['no data', ev({}, { data: undefined })], ['data array', ev({}, { data: [] })],
    ['eventId', ev({}, { eventId: 'x' })], ['occurredAt', ev({}, { occurredAt: 'ayer' })], ['correlation', ev({}, { correlationId: 'a' })],
    ['quoteId', ev({ quoteId: 'zz' })], ['number', ev({ quoteNumber: 'COT-1' })], ['number text', ev({ quoteNumber: 5 })], ['projectId', ev({ projectId: 'a b' })], ['projectId long', ev({ projectId: 'x'.repeat(41) })],
    ['amount 0', ev({ amountCop: 0 })], ['amount big', ev({ amountCop: 2_147_483_648 })], ['amount decimal', ev({ amountCop: 1.5 })], ['amount text', ev({ amountCop: '5' })],
    ['client empty', ev({ clientName: '' })], ['client markup', ev({ clientName: '<i>x</i>' })], ['client long', ev({ clientName: 'x'.repeat(121) })], ['project markup', ev({ projectName: '<b>' })], ['project short', ev({ projectName: 'x' })],
    ['email', ev({ approvedBy: 'nope' })],
  ])('refuses %s', (_n, raw) => { expect(() => parseQuoteApproved(raw)).toThrow(InvalidEventError); });
});
