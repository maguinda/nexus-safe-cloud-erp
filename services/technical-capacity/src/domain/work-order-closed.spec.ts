import { InvalidEventError, parseWorkOrderClosed } from './work-order-closed';

const ev = (data: object = {}, over: object = {}) => ({ eventId: '0B8F2C1E-5D4A-4E7B-9A63-1C2D3E4F5A01', type: 'WorkOrderClosed', occurredAt: '2026-11-02T15:00:00.000Z', correlationId: 'corr-12345678',
  data: { orderId: '11111111-1111-4111-8111-111111111111', orderNumber: 'OT-0007', outcome: 'done', ...data }, ...over });

describe('parseWorkOrderClosed', () => {
  it('keeps the order id (lowercase) and the event id', () => { expect(parseWorkOrderClosed(ev({ orderId: '11111111-1111-4111-8111-11111111AAAA' }))).toEqual({ eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01', orderId: '11111111-1111-4111-8111-11111111aaaa' }); });
  it('accepts an old event without orderId (nothing to free) and a cancellation', () => { expect(parseWorkOrderClosed(ev({ orderId: undefined })).orderId).toBe(''); expect(parseWorkOrderClosed(ev({ outcome: 'cancelled' })).orderId).toBeTruthy(); });
  it.each<[string, unknown]>([['null', null], ['array', []], ['other type', ev({}, { type: 'WorkOrderCreated' })], ['eventId', ev({}, { eventId: 'x' })], ['occurredAt', ev({}, { occurredAt: 'ayer' })], ['correlation', ev({}, { correlationId: 'a' })],
    ['no data', ev({}, { data: undefined })], ['data array', ev({}, { data: [] })], ['orderId', ev({ orderId: 'zz' })], ['orderId number', ev({ orderId: 5 })], ['outcome', ev({ outcome: 'lost' })]])('refuses %s', (_n, raw) => { expect(() => parseWorkOrderClosed(raw)).toThrow(InvalidEventError); });
});
