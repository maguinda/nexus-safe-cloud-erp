import { clearedRefreshCookie, readRefreshCookie, refreshCookie } from './session-cookie';

const T = 'A'.repeat(43);
describe('readRefreshCookie', () => {
  it('finds the token among other cookies, with or without spaces', () => {
    expect(readRefreshCookie(`erp_refresh=${T}`)).toBe(T);
    expect(readRefreshCookie(`a=1; erp_refresh=${T}; b=2`)).toBe(T);
    expect(readRefreshCookie(`a=1;erp_refresh=${T};b=2`)).toBe(T);
    expect(readRefreshCookie(`  erp_refresh = ${T} `)).toBe(T);
  });
  it.each([[undefined], [''], ['a=1; b=2'], ['xerp_refresh=abc'], ['erp_refreshx=abc'], ['erp_refresh'], ['=abc']])('there is none in %p', (h) => { expect(readRefreshCookie(h as string | undefined)).toBeUndefined(); });
  it('a cookie that appears twice is ignored (we do not guess which one is right)', () => { expect(readRefreshCookie(`erp_refresh=${T}; erp_refresh=${'B'.repeat(43)}`)).toBeUndefined(); });
  it('an absurdly long header is ignored', () => { expect(readRefreshCookie(`erp_refresh=${T}; x=${'y'.repeat(5000)}`)).toBeUndefined(); });
  it('does not decode or trim anything else: what comes back is what was sent', () => { expect(readRefreshCookie('erp_refresh=ab%20c')).toBe('ab%20c'); });
});

describe('the cookies we set', () => {
  it('HttpOnly, SameSite=Strict, only for /auth and with no Max-Age (a session cookie)', () => {
    const c = refreshCookie(T, { secure: false });
    expect(c).toBe(`erp_refresh=${T}; Path=/auth; HttpOnly; SameSite=Strict`);
    expect(c).not.toMatch(/Max-Age|Expires|Secure/i);
  });
  it('Secure is added over HTTPS', () => { expect(refreshCookie(T, { secure: true })).toMatch(/; Secure$/); });
  it('clearing it expires it at once, with the same path and flags so the browser really removes it', () => {
    const c = clearedRefreshCookie({ secure: true });
    expect(c).toContain('erp_refresh=;');
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('Path=/auth');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Secure');
  });
});
