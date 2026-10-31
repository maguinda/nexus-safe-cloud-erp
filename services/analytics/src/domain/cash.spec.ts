import { InvalidEventError } from './errors';
import { parseCashEvent } from './cash';

const ev = (type: string, data: object, over: object = {}) => ({ eventId: '0B8F2C1E-5D4A-4E7B-9A63-1C2D3E4F5A01', type, occurredAt: '2026-11-05T15:30:00.000Z', correlationId: 'corr-12345678', data, ...over });
const payment = { invoiceNumber: 'INV-0101', projectName: 'Branch network upgrade', paymentCop: 500_000, paidAt: '2026-11-04T10:00:00.000Z' };

describe('parseCashEvent', () => {
  it('a client payment is cash in on the day it was paid', () => { expect(parseCashEvent(ev('PaymentReceived', payment))).toEqual({ kind: 'entry', eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01', date: '2026-11-04', direction: 'in', category: 'customer', amountCop: 500_000, ref: 'INV-0101', projectName: 'Branch network upgrade' }); });
  it('a paid payroll and a paid supplier are cash out on the day of the event', () => {
    expect(parseCashEvent(ev('PayrollPaid', { totalCop: 90_000_000, period: '2026-10' }))).toMatchObject({ kind: 'entry', date: '2026-11-05', direction: 'out', category: 'payroll', amountCop: 90_000_000, ref: '2026-10', projectName: null });
    expect(parseCashEvent(ev('SupplierPaid', { amountCop: 4_800_000, payableNumber: 'CP-0007', projectName: null }))).toMatchObject({ direction: 'out', category: 'supplier', ref: 'CP-0007', projectName: null });
  });
  it('an approved quote keeps what it said it would cost', () => {
    expect(parseCashEvent(ev('QuoteApproved', { quoteNumber: 'COT-0002', projectId: 'p-ab12cd34', projectName: 'Cámaras y control de acceso', amountCop: 8_000_000, costCop: 6_400_000, marginPct: 25, approvedBy: 'Diana.Vega@Nexus.example' })))
      .toMatchObject({ kind: 'quote', quoteNumber: 'COT-0002', priceCop: 8_000_000, costCop: 6_400_000, marginPct: 25, approvedBy: 'diana.vega@nexus.example' });
  });
  it.each<[string, unknown]>([
    ['null', null], ['array', []], ['unknown type', ev('Other', {})], ['eventId', ev('PayrollPaid', { totalCop: 1, period: '2026-10' }, { eventId: 'x' })], ['correlation', ev('PayrollPaid', { totalCop: 1, period: '2026-10' }, { correlationId: 'a' })], ['occurredAt', ev('PayrollPaid', { totalCop: 1, period: '2026-10' }, { occurredAt: 'ayer' })], ['data', ev('PayrollPaid', {}, { data: 5 })],
    ['payment 0', ev('PaymentReceived', { ...payment, paymentCop: 0 })], ['payment decimal', ev('PaymentReceived', { ...payment, paymentCop: 1.5 })], ['payment text', ev('PaymentReceived', { ...payment, paymentCop: '5' })], ['payment huge', ev('PaymentReceived', { ...payment, paymentCop: 100_000_000_001 })], ['paidAt', ev('PaymentReceived', { ...payment, paidAt: 'x' })], ['invoice markup', ev('PaymentReceived', { ...payment, invoiceNumber: '<b>' })],
    ['period', ev('PayrollPaid', { totalCop: 1, period: '2026-13' })], ['payroll 0', ev('PayrollPaid', { totalCop: 0, period: '2026-10' })], ['supplier number', ev('SupplierPaid', { amountCop: 1, payableNumber: '' })], ['supplier project markup', ev('SupplierPaid', { amountCop: 1, payableNumber: 'CP-1', projectName: '<i>x</i>' })],
    ['quote number', ev('QuoteApproved', { quoteNumber: 'x', projectId: 'p-1', projectName: 'Proyecto', amountCop: 1, costCop: 0, marginPct: 25, approvedBy: 'a@b.co' })], ['quote margin', ev('QuoteApproved', { quoteNumber: 'COT-0001', projectId: 'p-1', projectName: 'Proyecto', amountCop: 1, costCop: 0, marginPct: 101, approvedBy: 'a@b.co' })], ['quote email', ev('QuoteApproved', { quoteNumber: 'COT-0001', projectId: 'p-1', projectName: 'Proyecto', amountCop: 1, costCop: 0, marginPct: 25, approvedBy: 'no' })],
  ])('refuses %s', (_n, raw) => { expect(() => parseCashEvent(raw)).toThrow(InvalidEventError); });
});
