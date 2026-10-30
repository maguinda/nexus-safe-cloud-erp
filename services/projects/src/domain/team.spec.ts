import { InvalidEventError } from './errors';
import { parseEngineerAllocated } from './team';

const ev = (data: object = {}, over: object = {}) => ({ eventId: '0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01', type: 'EngineerAllocated', occurredAt: '2026-10-30T10:00:00.000Z', correlationId: 'corr-12345678',
  data: { allocationId: '5a1c0e2f-1111-4b2c-8d3e-9f0a1b2c3d4e', engineerName: 'Camila Torres (example)', projectName: 'Branch network upgrade', percent: 50, periodStart: '2026-11-01', periodEnd: '2026-12-15', ...data }, ...over });

describe('parseEngineerAllocated', () => {
  it('accepts a valid event, keeps only what is shown and ignores extra fields', () => {
    const m = parseEngineerAllocated(ev({ dailyCostCop: 400000, secret: 'x' }));
    expect(m).toEqual({ allocationId: '5a1c0e2f-1111-4b2c-8d3e-9f0a1b2c3d4e', engineerName: 'Camila Torres (example)', projectName: 'Branch network upgrade', percent: 50, periodStart: '2026-11-01', periodEnd: '2026-12-15', occurredAt: new Date('2026-10-30T10:00:00.000Z') });
    expect(Object.keys(m)).not.toContain('dailyCostCop');
  });
  it.each<[string, unknown]>([
    ['null', null], ['an array', []], ['another type', ev({}, { type: 'OverAllocationDetected' })], ['no data', ev({}, { data: undefined })], ['bad occurredAt', ev({}, { occurredAt: 'ayer' })],
    ['allocationId not a UUID', ev({ allocationId: '1; DROP' })], ['percent 0', ev({ percent: 0 })], ['percent 101', ev({ percent: 101 })], ['percent decimal', ev({ percent: 50.5 })], ['percent text', ev({ percent: '50' })],
    ['name with <', ev({ engineerName: '<b>x</b>' })], ['empty project', ev({ projectName: '  ' })], ['long name', ev({ engineerName: 'x'.repeat(121) })], ['control char', ev({ engineerName: 'a\u0000b' })],
    ['impossible date', ev({ periodStart: '2026-02-30' })], ['end before start', ev({ periodEnd: '2026-10-01' })], ['date as text', ev({ periodEnd: 'mañana' })],
  ])('refuses %s', (_n, raw) => { expect(() => parseEngineerAllocated(raw)).toThrow(InvalidEventError); });
});
