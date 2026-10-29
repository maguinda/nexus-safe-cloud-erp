import { randomUUID } from 'crypto';
import { InvalidEventError } from './errors';
import { AUDIENCE, KINDS, parseEvent } from './events';

const env = (type: string, data: any, over: any = {}) => ({ eventId: randomUUID(), type, occurredAt: '2026-11-20T00:00:00.000Z', correlationId: 'overdue-20261120-1a2b3c4d', data, ...over });
const overdue = (over: any = {}) => env('OverdueDetected', { invoiceNumber: 'INV-0103', milestoneId: 'm2', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design',
  amountCop: 18_500_000, taxCop: 3_515_000, totalCop: 22_015_000, dueDate: '2026-11-17T15:00:00.000Z', daysOverdue: 3, clientName: 'Banco Andino (example)', ...over });
const threshold = (over: any = {}) => env('ThresholdBreached', { deviceName: 'Cold room sensor', location: 'Bogotá', readingKind: 'temperature', status: 'ALERT', value: 31.5, unit: '°C', ...over });
const over = (over2: any = {}) => env('OverAllocationDetected', { engineerName: 'Ing. Example', allocationPercent: 120, periodStart: '2026-11-01', periodEnd: '2026-11-30', ...over2 });

describe('parseEvent', () => {
  it('turns an overdue invoice into a warning for billing and management, keeping only what the screen shows', () => {
    const e = parseEvent(overdue());
    expect(e).toMatchObject({ kind: 'OverdueDetected', severity: 'warning', audienceRoles: ['billing_analyst', 'manager'] });
    expect(e.params).toEqual({ invoiceNumber: 'INV-0103', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', totalCop: 22_015_000, daysOverdue: 3 });
    expect(JSON.stringify(e)).not.toContain('Banco Andino'); // el cliente no se guarda
  });
  it('ranks an ALERT threshold as critical and a WARNING as warning, for management only', () => {
    expect(parseEvent(threshold())).toMatchObject({ kind: 'ThresholdBreached', severity: 'critical', audienceRoles: ['manager'] });
    expect(parseEvent(threshold({ status: 'WARNING' })).severity).toBe('warning');
  });
  it('turns an over-allocation into a warning for management and sales', () => {
    expect(parseEvent(over())).toMatchObject({ kind: 'OverAllocationDetected', audienceRoles: ['manager', 'sales'], params: { engineerName: 'Ing. Example', allocationPercent: 120 } });
  });
  it('lowercases the event id and ignores unknown extra fields', () => {
    const id = randomUUID().toUpperCase();
    expect(parseEvent({ ...overdue(), eventId: id }).eventId).toBe(id.toLowerCase());
    expect(Object.keys(parseEvent(threshold({ extra: 1 })).params)).not.toContain('extra');
  });
  it('every kind has an audience and every audience is a known role', () => {
    for (const k of KINDS) expect(AUDIENCE[k].length).toBeGreaterThan(0);
  });

  const bad: [string, unknown][] = [
    ['null', null], ['an array', []], ['a string', 'x'], ['no event id', { ...overdue(), eventId: undefined }], ['bad event id', { ...overdue(), eventId: 'nope' }],
    ['bad date', { ...overdue(), occurredAt: 'yesterday' }], ['bad correlation id', { ...overdue(), correlationId: 'a b' }], ['data not an object', env('OverdueDetected', 'x')],
    ['unknown type', env('Surprise', {})], ['no type', { ...overdue(), type: undefined }],
    ['invoice number wrong', overdue({ invoiceNumber: 'FE-1' })], ['0 days overdue', overdue({ daysOverdue: 0 })], ['fractional days', overdue({ daysOverdue: 1.5 })],
    ['total that does not add up', overdue({ totalCop: 5 })], ['empty project', overdue({ projectName: '  ' })], ['huge project name', overdue({ projectName: 'x'.repeat(201) })],
    ['threshold value as text', threshold({ value: '31' })], ['threshold value NaN', threshold({ value: NaN })], ['threshold without unit', threshold({ unit: undefined })],
    ['allocation of exactly 100', over({ allocationPercent: 100 })], ['allocation as text', over({ allocationPercent: '120' })], ['allocation without period', over({ periodStart: undefined })],
  ];
  it.each(bad)('rejects %s', (_n, raw) => { expect(() => parseEvent(raw)).toThrow(InvalidEventError); });
});
