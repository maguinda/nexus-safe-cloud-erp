import type { ReadingRetention } from '../domain/ports';
import { DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, retentionCutoff } from '../domain/retention';
import { DeleteOldReadingsUseCase, MAX_BATCHES_PER_PASS, RETENTION_BATCH } from './delete-old-readings.use-case';

const NOW = new Date('2026-11-01T00:00:00Z');
class Fake implements ReadingRetention {
  calls: { cutoff: Date; limit: number }[] = [];
  constructor(private left: number) {}
  async deleteOlderThan(cutoff: Date, limit: number) { this.calls.push({ cutoff, limit }); const n = Math.min(limit, this.left); this.left -= n; return n; }
}

describe('retentionCutoff', () => {
  it('subtracts whole days', () => { expect(retentionCutoff(NOW, 365)?.toISOString()).toBe('2025-11-01T00:00:00.000Z'); });
  it('0 means off', () => { expect(retentionCutoff(NOW, 0)).toBeNull(); });
  it.each([-1, 1, 29, 0.5, NaN, Infinity])('refuses a dangerous period %p (it would delete data the dashboard needs)', (d) => { expect(() => retentionCutoff(NOW, d)).toThrow(); });
  it('accepts the minimum and the default', () => { expect(retentionCutoff(NOW, MIN_RETENTION_DAYS)).not.toBeNull(); expect(DEFAULT_RETENTION_DAYS).toBeGreaterThanOrEqual(365); });
});

describe('DeleteOldReadingsUseCase', () => {
  it('does nothing when retention is off', async () => {
    const f = new Fake(100);
    expect(await new DeleteOldReadingsUseCase(f, 0, () => NOW).execute()).toEqual({ deleted: 0 }); expect(f.calls).toHaveLength(0);
  });
  it('deletes in batches until a batch comes back short', async () => {
    const f = new Fake(RETENTION_BATCH * 2 + 17);
    expect(await new DeleteOldReadingsUseCase(f, 365, () => NOW).execute()).toEqual({ deleted: RETENTION_BATCH * 2 + 17 });
    expect(f.calls).toHaveLength(3); expect(f.calls.every((c) => c.limit === RETENTION_BATCH && c.cutoff.toISOString() === '2025-11-01T00:00:00.000Z')).toBe(true);
  });
  it('stops after the maximum number of batches in one pass; the next pass goes on', async () => {
    const f = new Fake(RETENTION_BATCH * (MAX_BATCHES_PER_PASS + 5));
    const uc = new DeleteOldReadingsUseCase(f, 365, () => NOW);
    expect((await uc.execute()).deleted).toBe(RETENTION_BATCH * MAX_BATCHES_PER_PASS);
    expect((await uc.execute()).deleted).toBe(RETENTION_BATCH * 5);
  });
  it('a dangerous period fails loudly instead of deleting', async () => {
    await expect(new DeleteOldReadingsUseCase(new Fake(10), 7, () => NOW).execute()).rejects.toThrow();
  });
});
