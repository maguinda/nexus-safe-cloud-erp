import { INGEST_MAX_BATCH, MAX_FUTURE_MS, NOTE_MAX, READING_STATUSES, validateBatch } from './ingest';

const UNITS = new Map([['IOT-OF1-01', 'FPS'], ['TEMP_MON_OF1', '°C']]);
const NOW = new Date('2026-10-28T12:00:00.000Z');
const ok = (o: Record<string, unknown> = {}) => ({ deviceId: 'TEMP_MON_OF1', recordedAt: '2026-09-13T11:21:00Z', status: 'NORMAL', value: 22.5, unit: '°C', note: 'ok', ...o });
const run = (body: unknown) => validateBatch(body, UNITS, NOW);
const paths = (body: unknown) => run(body).problems.map((p) => p.path);

describe('validateBatch', () => {
  it('accepts a valid batch and returns the readings as dates and numbers', () => {
    const r = run({ readings: [ok(), ok({ deviceId: 'IOT-OF1-01', unit: 'FPS', value: 30, status: 'ACTIVE', note: undefined })] });
    expect(r.problems).toEqual([]);
    expect(r.readings).toHaveLength(2);
    expect(r.readings[0]).toEqual({ deviceId: 'TEMP_MON_OF1', recordedAt: new Date('2026-09-13T11:21:00.000Z'), status: 'NORMAL', value: 22.5, unit: '°C', note: 'ok' });
    expect(r.readings[1].note).toBeNull();
  });

  it('accepts zone offsets and milliseconds, and stores the same instant', () => {
    const a = run({ readings: [ok({ recordedAt: '2026-09-13T06:21:00-05:00' })] }).readings[0].recordedAt.getTime();
    expect(a).toBe(new Date('2026-09-13T11:21:00Z').getTime());
    expect(run({ readings: [ok({ recordedAt: '2026-09-13T11:21:00.250Z' })] }).problems).toEqual([]);
  });

  it.each([null, undefined, 'x', 5, [], [ok()]])('rejects a body that is not an object with readings: %p', (b) => { expect(run(b).problems.length).toBeGreaterThan(0); });
  it('rejects unknown top-level fields', () => { expect(paths({ readings: [ok()], extra: 1 })).toEqual(['extra']); });
  it('rejects readings that is not an array, an empty array and more than the maximum', () => {
    expect(paths({ readings: 'x' })).toEqual(['readings']);
    expect(paths({ readings: [] })).toEqual(['readings']);
    const big = Array.from({ length: INGEST_MAX_BATCH + 1 }, (_, i) => ok({ recordedAt: new Date(Date.UTC(2026, 8, 13, 11, 21 + i)).toISOString() }));
    expect(paths({ readings: big })).toEqual(['readings']);
    const full = Array.from({ length: INGEST_MAX_BATCH }, (_, i) => ok({ recordedAt: new Date(Date.UTC(2026, 8, 13, 11, 21 + i)).toISOString() }));
    expect(run({ readings: full }).problems).toEqual([]);
  });

  it('rejects an unknown device and a unit that is not the one of the device', () => {
    expect(paths({ readings: [ok({ deviceId: 'NOPE' })] })).toEqual(['readings[0].deviceId']);
    expect(paths({ readings: [ok({ unit: 'FPS' })] })).toEqual(['readings[0].unit']);
    expect(paths({ readings: [ok({ deviceId: 5 })] })).toContain('readings[0].deviceId');
  });

  it.each(['2026-09-13 11:21:00', '2026-09-13T11:21:00', '13/09/2026', '2026-09-13', '', 'now', 1789000000000, null])('rejects a date-time that is not ISO 8601 with a zone: %p', (v) => { expect(paths({ readings: [ok({ recordedAt: v })] })).toEqual(['readings[0].recordedAt']); });
  it('rejects a date that does not exist, one in the future and one before the year 2000', () => {
    expect(paths({ readings: [ok({ recordedAt: '2026-02-31T10:00:00Z' })] })).toEqual(['readings[0].recordedAt']);
    expect(paths({ readings: [ok({ recordedAt: new Date(NOW.getTime() + MAX_FUTURE_MS + 1000).toISOString() })] })).toEqual(['readings[0].recordedAt']);
    expect(run({ readings: [ok({ recordedAt: new Date(NOW.getTime() + MAX_FUTURE_MS - 1000).toISOString() })] }).problems).toEqual([]);
    expect(paths({ readings: [ok({ recordedAt: '1999-12-31T23:59:59Z' })] })).toEqual(['readings[0].recordedAt']);
  });

  it.each(['2026-02-29T10:00:00Z', '2026-04-31T10:00:00Z', '2026-13-01T10:00:00Z', '2026-00-10T10:00:00Z', '2026-09-13T24:00:00Z', '2026-09-13T10:60:00Z', '2026-09-13T10:00:60Z', '2026-09-13T10:00:00+25:00', '2026-09-13T10:00:00+05:99'])('rejects a date-time that does not exist instead of letting JavaScript roll it over: %s', (v) => { expect(paths({ readings: [ok({ recordedAt: v })] })).toEqual(['readings[0].recordedAt']); });
  it('accepts the 29th of February of a leap year and the last second of the day', () => {
    expect(run({ readings: [ok({ recordedAt: '2024-02-29T23:59:59Z' })] }).problems).toEqual([]);
    expect(run({ readings: [ok({ recordedAt: '2026-09-13T23:59:59.999+14:00' })] }).problems).toEqual([]);
  });

  it.each(['normal', 'BROKEN', '', null, 1])('rejects a status outside the catalog: %p', (v) => { expect(paths({ readings: [ok({ status: v })] })).toEqual(['readings[0].status']); });
  it('accepts every status of the catalog', () => { for (const s of READING_STATUSES) expect(run({ readings: [ok({ status: s })] }).problems).toEqual([]); });

  it.each([null, undefined, '22.5', 'NaN', NaN, Infinity, -Infinity, true, {}, []])('rejects a value that is not a finite number: %p', (v) => { expect(paths({ readings: [ok({ value: v })] })).toEqual(['readings[0].value']); });
  it('accepts 0, negatives and very small numbers', () => { for (const v of [0, -12.5, 1e-9, 1e15]) expect(run({ readings: [ok({ value: v })] }).problems).toEqual([]); });

  it('limits the note and accepts it missing or null', () => {
    expect(paths({ readings: [ok({ note: 'x'.repeat(NOTE_MAX + 1) })] })).toEqual(['readings[0].note']);
    expect(run({ readings: [ok({ note: 'x'.repeat(NOTE_MAX) })] }).problems).toEqual([]);
    expect(paths({ readings: [ok({ note: 5 })] })).toEqual(['readings[0].note']);
    expect(run({ readings: [ok({ note: null })] }).problems).toEqual([]);
  });

  it('rejects unknown fields inside a reading (e.g. an id: the database generates it)', () => {
    expect(paths({ readings: [ok({ id: 7 })] })).toEqual(['readings[0].id']);
  });

  it('rejects the same device and instant twice inside one batch, even if written with different zones', () => {
    expect(paths({ readings: [ok(), ok({ recordedAt: '2026-09-13T06:21:00-05:00' })] })).toEqual(['readings[1].recordedAt']);
  });

  it('is all or nothing: one bad reading empties the result and ALL the problems are reported', () => {
    const r = run({ readings: [ok(), ok({ recordedAt: '2026-09-13T11:22:00Z', value: 'x' }), ok({ recordedAt: '2026-09-13T11:23:00Z', status: 'BAD', deviceId: 'NOPE' })] });
    expect(r.readings).toEqual([]);
    expect(r.problems.map((p) => p.path)).toEqual(['readings[1].value', 'readings[2].deviceId', 'readings[2].status']);
  });

  it('does not mutate its input', () => {
    const body = { readings: [ok()] }; const copy = JSON.parse(JSON.stringify(body));
    run(body);
    expect(body).toEqual(copy);
  });
});
