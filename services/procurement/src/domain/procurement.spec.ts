import { randomUUID } from 'crypto';
import { newItem, newSupplier } from './catalog';
import { ConflictError, InvalidEventError, ValidationError } from './errors';
import { orderNumber, parseThreshold } from './events';
import { applyDelta, assertCancellable, assertReceivable, MAX_STOCK, newOrder, validateAdjustment } from './order';

describe('supplier and item', () => {
  it('cleans the text and defaults the terms', () => { expect(newSupplier('  Redes   del Norte ', 'fixed', undefined)).toMatchObject({ name: 'Redes del Norte', kind: 'fixed', terms: '' }); });
  it.each([['A', 'fixed'], ['<b>x</b>', 'fixed'], ['Valid name', 'other'], [5, 'fixed'], ['x'.repeat(81), 'tender']])('rejects supplier %p/%p', (n, k) => { expect(() => newSupplier(n, k, '')).toThrow(ValidationError); });
  it('keeps the measures upper-case without repeats; starts with zero stock', () => {
    expect(newItem('Sensor TH', 'spare', ['temp', 'TEMP', 'humidity'])).toMatchObject({ forKinds: ['TEMP', 'HUMIDITY'], onHand: 0 });
  });
  it.each<[unknown, unknown, unknown]>([['Sensor', 'device', []], ['S', 'spare', []], ['Sensor', 'spare', 'TEMP'], ['Sensor', 'spare', Array(11).fill('abcd')]])('rejects item %p %p %p', (n, k, f) => { expect(() => newItem(n, k, f)).toThrow(ValidationError); });
});

describe('purchase order rules', () => {
  const s = randomUUID(), i = randomUUID();
  it('computes the total', () => { expect(newOrder(s, i, 4, 250_000)).toMatchObject({ quantity: 4, unitPriceCop: 250_000, totalCop: 1_000_000 }); });
  it.each([[0, 1000], [100_001, 1000], [1.5, 1000], ['3', 1000], [3, 0], [3, 1.5], [3, 1_000_000_001], [100_000, 100_000]])('rejects quantity %p price %p', (q, p) => { expect(() => newOrder(s, i, q, p)).toThrow(ValidationError); });
  it('rejects bad ids', () => { expect(() => newOrder('x', i, 1, 1)).toThrow(ValidationError); expect(() => newOrder(s, null, 1, 1)).toThrow(ValidationError); });
  it('only a pending order can be received or cancelled', () => {
    expect(() => assertReceivable('ordered')).not.toThrow(); expect(() => assertCancellable('ordered')).not.toThrow();
    for (const st of ['received', 'cancelled'] as const) { expect(() => assertReceivable(st)).toThrow(ConflictError); expect(() => assertCancellable(st)).toThrow(ConflictError); }
  });
  it('numbers like PO-0007', () => { expect(orderNumber(7)).toBe('PO-0007'); expect(orderNumber(12345)).toBe('PO-12345'); });
});

describe('stock', () => {
  it('moves by a delta', () => { expect(applyDelta(5, 3, 'x')).toBe(8); expect(applyDelta(5, -5, 'x')).toBe(0); });
  it('never goes below zero or above the cap', () => { expect(() => applyDelta(2, -3, 'Sensor')).toThrow(ConflictError); expect(() => applyDelta(MAX_STOCK, 1, 'Sensor')).toThrow(ConflictError); });
  it.each([[0], [1.5], ['3'], [100_001], [-100_001], [NaN]])('rejects delta %p', (d) => { expect(() => validateAdjustment(d, 'Stock count')).toThrow(ValidationError); });
  it.each([['ab'], [''], ['<x>y'], [5]])('rejects reason %p', (r) => { expect(() => validateAdjustment(2, r)).toThrow(ValidationError); });
  it('accepts a normal adjustment', () => { expect(validateAdjustment(-2, '  Stock   count ')).toEqual({ delta: -2, reason: 'Stock count' }); });
});

describe('parseThreshold (the alert that arrives from operations)', () => {
  const ev = (d: object = {}, o: object = {}) => ({ eventId: randomUUID(), type: 'ThresholdBreached', occurredAt: '2026-11-05T14:00:00.000Z', correlationId: 'trace-0001-abcd', data: { deviceName: 'TEMP_MON_OF1', location: 'Medellín', readingKind: 'temp', status: 'ALERT', value: 31.5, unit: '°C', ...d }, ...o });
  it('accepts it and upper-cases the measure', () => { expect(parseThreshold(ev())).toMatchObject({ readingKind: 'TEMP', status: 'ALERT', value: 31.5 }); });
  it.each([[null], [[]], [ev({}, { type: 'Other' })], [ev({}, { eventId: 'x' })], [ev({ value: '3' })], [ev({ value: 1e12 })], [ev({ deviceName: '' })], [ev({ unit: 'x'.repeat(21) })], [ev({}, { occurredAt: 'yesterday' })]])('rejects %#', (raw) => { expect(() => parseThreshold(raw)).toThrow(InvalidEventError); });
});
