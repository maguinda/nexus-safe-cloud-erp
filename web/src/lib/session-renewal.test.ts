import { describe, expect, it } from 'vitest';
import { classifyRenewal, CONFLICT_RETRIES, CONFLICT_RETRY_MS, isSamePerson, RENEW_BUFFER_S, shouldRenew, TRANSIENT_RETRY_MS } from './session-renewal';

describe('shouldRenew', () => {
  it('renews when two minutes or less are left, including after it already expired, and not before', () => {
    expect(shouldRenew(900)).toBe(false);
    expect(shouldRenew(RENEW_BUFFER_S + 1)).toBe(false);
    expect(shouldRenew(RENEW_BUFFER_S)).toBe(true);
    expect(shouldRenew(30)).toBe(true);
    expect(shouldRenew(0)).toBe(true);
  });
  it('the margin is bigger than the retries it has to fit (conflict retries and one transient retry)', () => {
    expect(RENEW_BUFFER_S * 1000).toBeGreaterThan(CONFLICT_RETRIES * CONFLICT_RETRY_MS + TRANSIENT_RETRY_MS);
  });
});

describe('classifyRenewal', () => {
  it.each([[200, 'renewed'], [409, 'conflict'], [401, 'expired'], [403, 'expired'], [429, 'transient'], [500, 'transient'], [502, 'transient'], [503, 'transient'], [504, 'transient'], [404, 'transient'], ['network', 'transient']] as const)('%s -> %s', (status, kind) => { expect(classifyRenewal(status)).toBe(kind); });
  it('a 401 is never retried (the session is gone) while an unknown error is (nothing is known about the session)', () => {
    expect(classifyRenewal(401)).not.toBe('transient');
    expect(classifyRenewal(418)).toBe('transient');
  });
});

describe('isSamePerson', () => {
  it('the same email, whatever the case or the spaces', () => { expect(isSamePerson({ email: 'laura.rios@nexus.example' }, { email: ' Laura.Rios@Nexus.example ' })).toBe(true); });
  it('another person is not the same, even if the email only differs a little', () => {
    expect(isSamePerson({ email: 'laura.rios@nexus.example' }, { email: 'diana.vega@nexus.example' })).toBe(false);
    expect(isSamePerson({ email: 'laura.rios@nexus.example' }, { email: 'laura.rios@nexus.example.evil' })).toBe(false);
    expect(isSamePerson({ email: 'a@x.co' }, { email: '' })).toBe(false);
  });
});
