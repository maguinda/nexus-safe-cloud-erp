import type { NewReading } from '../domain/ingest';
import type { ReadingIngest } from '../domain/ports';
import { IngestReadingsUseCase, IngestRejectedError } from './ingest-readings.use-case';

class FakeStore implements ReadingIngest {
  rows = new Map<string, NewReading>();
  inserts = 0;
  async deviceUnits() { return new Map([['TEMP_MON_OF1', '°C']]); }
  async insertReadings(rows: NewReading[]) {
    this.inserts++;
    let n = 0;
    for (const r of rows) { const k = `${r.deviceId}|${r.recordedAt.getTime()}`; if (!this.rows.has(k)) { this.rows.set(k, r); n++; } }
    return n;
  }
}
const NOW = new Date('2026-10-28T12:00:00Z');
const reading = (min: number, o: Record<string, unknown> = {}) => ({ deviceId: 'TEMP_MON_OF1', recordedAt: new Date(Date.UTC(2026, 8, 13, 11, min)).toISOString(), status: 'NORMAL', value: 22, unit: '°C', ...o });

describe('IngestReadingsUseCase', () => {
  it('stores a valid batch and says how many entered', async () => {
    const store = new FakeStore();
    expect(await new IngestReadingsUseCase(store, () => NOW).execute({ readings: [reading(21), reading(22)] })).toEqual({ accepted: 2, duplicates: 0 });
    expect(store.rows.size).toBe(2);
  });

  it('is idempotent: sending the same batch again stores nothing and reports the duplicates', async () => {
    const store = new FakeStore(); const uc = new IngestReadingsUseCase(store, () => NOW);
    await uc.execute({ readings: [reading(21), reading(22)] });
    expect(await uc.execute({ readings: [reading(21), reading(22), reading(23)] })).toEqual({ accepted: 1, duplicates: 2 });
    expect(store.rows.size).toBe(3);
  });

  it('all or nothing: an invalid reading rejects the batch and the store is never written', async () => {
    const store = new FakeStore();
    await expect(new IngestReadingsUseCase(store, () => NOW).execute({ readings: [reading(21), reading(22, { value: 'x' })] })).rejects.toBeInstanceOf(IngestRejectedError);
    expect(store.inserts).toBe(0);
    expect(store.rows.size).toBe(0);
  });

  it('the rejection carries every problem', async () => {
    const e = await new IngestReadingsUseCase(new FakeStore(), () => NOW).execute({ readings: [reading(21, { status: 'X' }), reading(22, { unit: 'W' })] }).catch((x) => x);
    expect(e).toBeInstanceOf(IngestRejectedError);
    expect((e as IngestRejectedError).problems.map((p) => p.path)).toEqual(['readings[0].status', 'readings[1].unit']);
  });

  it('uses the clock it was given to decide what is "the future"', async () => {
    const store = new FakeStore();
    await expect(new IngestReadingsUseCase(store, () => new Date('2020-01-01T00:00:00Z')).execute({ readings: [reading(21)] })).rejects.toBeInstanceOf(IngestRejectedError);
  });
});
