import { InvalidEventError } from './errors';
import { parseEquipmentInstalled, parseEquipmentPurchased, parseEquipmentRetired, unitName } from './purchased';

const ev = (data: object = {}, over: object = {}) => ({ eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01', type: 'EquipmentPurchased', occurredAt: '2026-10-30T10:00:00.000Z', correlationId: 'corr-12345678',
  data: { orderNumber: 'PO-0007', orderId: 'x', supplierName: 'Proveedor', itemName: '  Router   edge  ', quantity: 2, unitPriceCop: 100, totalCop: 200, ...data }, ...over });
describe('parseEquipmentPurchased', () => {
  it('keeps only the order, the item (clean) and the quantity', () => { expect(parseEquipmentPurchased(ev())).toEqual({ orderNumber: 'PO-0007', itemName: 'Router edge', quantity: 2 }); });
  it('accepts 1 and 100 units', () => { expect(parseEquipmentPurchased(ev({ quantity: 1 })).quantity).toBe(1); expect(parseEquipmentPurchased(ev({ quantity: 100 })).quantity).toBe(100); });
  it.each<[string, unknown]>([['null', null], ['an array', []], ['another type', ev({}, { type: 'StockChanged' })], ['no data', ev({}, { data: undefined })], ['order without PO', ev({ orderNumber: 'X-1' })], ['order injection', ev({ orderNumber: "PO-1'; DROP" })],
    ['quantity 0', ev({ quantity: 0 })], ['quantity 101', ev({ quantity: 101 })], ['decimal', ev({ quantity: 1.5 })], ['text', ev({ quantity: '2' })], ['markup in item', ev({ itemName: '<b>x</b>' })], ['empty item', ev({ itemName: '  ' })], ['long item', ev({ itemName: 'x'.repeat(101) })], ['control char', ev({ itemName: 'a\u0000b' })],
  ])('refuses %s', (_n, raw) => { expect(() => parseEquipmentPurchased(raw)).toThrow(InvalidEventError); });
  it('the unit name is unique per order and unit, and fits the name limit', () => {
    expect(unitName('Router edge', 'PO-0007', 2)).toBe('Router edge (PO-0007-2)');
    expect(unitName('x'.repeat(100), 'PO-0007', 100).length).toBeLessThanOrEqual(120);
  });
});

describe('parseEquipmentInstalled', () => {
  const inst = (data: object = {}, over: object = {}) => ({ eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01', type: 'EquipmentInstalled', occurredAt: '2026-10-30T10:00:00.000Z', correlationId: 'corr-12345678', data: { installNumber: 'INS-0007', itemId: 'x', itemName: '  Router   edge ', ...data }, ...over });
  it('keeps only the install number and the item (clean)', () => { expect(parseEquipmentInstalled(inst())).toEqual({ installNumber: 'INS-0007', itemName: 'Router edge' }); });
  it.each<[string, unknown]>([['null', null], ['an array', []], ['another type', inst({}, { type: 'EquipmentPurchased' })], ['no data', inst({}, { data: undefined })], ['number without INS', inst({ installNumber: 'PO-0001' })], ['number injection', inst({ installNumber: "INS-1'; DROP" })],
    ['markup item', inst({ itemName: '<b>x</b>' })], ['empty item', inst({ itemName: ' ' })], ['long item', inst({ itemName: 'x'.repeat(101) })], ['control char', inst({ itemName: 'a\u0000b' })],
  ])('refuses %s', (_n, raw) => { expect(() => parseEquipmentInstalled(raw)).toThrow(InvalidEventError); });
});

describe('parseEquipmentRetired', () => {
  const ret = (data: object = {}, over: object = {}) => ({ eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01', type: 'EquipmentRetired', occurredAt: '2026-10-30T10:00:00.000Z', correlationId: 'corr-12345678', data: { installNumber: 'INS-0007', itemId: 'x', itemName: 'Router', destination: 'storage', ...data }, ...over });
  it('keeps the number and the destination', () => { expect(parseEquipmentRetired(ret())).toEqual({ installNumber: 'INS-0007', destination: 'storage' }); expect(parseEquipmentRetired(ret({ destination: 'retired' })).destination).toBe('retired'); });
  it.each<[string, unknown]>([['null', null], ['array', []], ['other type', ret({}, { type: 'EquipmentInstalled' })], ['no data', ret({}, { data: undefined })], ['bad number', ret({ installNumber: 'PO-1' })], ['bad destination', ret({ destination: 'lost' })], ['no destination', ret({ destination: undefined })]])('refuses %s', (_n, raw) => { expect(() => parseEquipmentRetired(raw)).toThrow(InvalidEventError); });
});
