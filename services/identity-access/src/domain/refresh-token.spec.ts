import { hashRefreshToken, judgeRefresh, newRefreshToken, REFRESH_TOKEN_PATTERN, REUSE_GRACE_MS, RefreshRecord } from './refresh-token';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const rec = (o: Partial<RefreshRecord> = {}): RefreshRecord => ({ userId: 'u', familyId: 'f', expiresAt: at(30 * 60_000), familyExpiresAt: at(8 * 3_600_000), usedAt: null, revokedAt: null, ...o });

describe('newRefreshToken', () => {
  it('is 43 url-safe characters (256 random bits) and its hash is a 64-char hex SHA-256 of it', () => {
    const t = newRefreshToken();
    expect(t.token).toMatch(REFRESH_TOKEN_PATTERN);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).toBe(hashRefreshToken(t.token));
    expect(t.hash).not.toContain(t.token);
  });
  it('never repeats (1000 tokens) and the hash is deterministic', () => {
    const all = new Set(Array.from({ length: 1000 }, () => newRefreshToken().token));
    expect(all.size).toBe(1000);
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('abd'));
  });
});

describe('REFRESH_TOKEN_PATTERN', () => {
  it.each(['', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)} `, `${'a'.repeat(42)}/`, `${'a'.repeat(42)}\n`, '%'.repeat(43)])('rejects %j', (v) => { expect(REFRESH_TOKEN_PATTERN.test(v)).toBe(false); });
  it('accepts a valid shape', () => { expect(REFRESH_TOKEN_PATTERN.test('A-_z'.repeat(10) + 'abc')).toBe(true); });
});

describe('judgeRefresh', () => {
  it('a fresh unused token is ok', () => { expect(judgeRefresh(rec(), NOW)).toBe('ok'); });
  it('a token that does not exist is invalid', () => { expect(judgeRefresh(null, NOW)).toBe('invalid'); });
  it('a revoked token is invalid, even if it is also unused and unexpired', () => { expect(judgeRefresh(rec({ revokedAt: at(-1000) }), NOW)).toBe('invalid'); });
  it('expired by inactivity is invalid; exactly at the expiry instant too', () => {
    expect(judgeRefresh(rec({ expiresAt: at(-1) }), NOW)).toBe('invalid');
    expect(judgeRefresh(rec({ expiresAt: NOW }), NOW)).toBe('invalid');
    expect(judgeRefresh(rec({ expiresAt: at(1) }), NOW)).toBe('ok');
  });
  it('past the absolute limit of the session is invalid, however fresh the token is', () => {
    expect(judgeRefresh(rec({ familyExpiresAt: at(-1) }), NOW)).toBe('invalid');
    expect(judgeRefresh(rec({ familyExpiresAt: NOW }), NOW)).toBe('invalid');
  });
  it('used a moment ago is a race (retry): up to and including the grace margin', () => {
    expect(judgeRefresh(rec({ usedAt: at(-1) }), NOW)).toBe('retry');
    expect(judgeRefresh(rec({ usedAt: at(-REUSE_GRACE_MS) }), NOW)).toBe('retry');
  });
  it('used longer ago than the margin is reuse (a copy is being used)', () => {
    expect(judgeRefresh(rec({ usedAt: at(-REUSE_GRACE_MS - 1) }), NOW)).toBe('reuse');
    expect(judgeRefresh(rec({ usedAt: at(-3_600_000) }), NOW)).toBe('reuse');
  });
  it('a used token that is also expired or revoked is simply invalid: nothing to revoke, nothing to retry', () => {
    expect(judgeRefresh(rec({ usedAt: at(-3_600_000), expiresAt: at(-1) }), NOW)).toBe('invalid');
    expect(judgeRefresh(rec({ usedAt: at(-1000), revokedAt: at(-500) }), NOW)).toBe('invalid');
  });
  it('the margin is a parameter', () => {
    expect(judgeRefresh(rec({ usedAt: at(-500) }), NOW, 100)).toBe('reuse');
    expect(judgeRefresh(rec({ usedAt: at(-500) }), NOW, 1000)).toBe('retry');
  });
});
