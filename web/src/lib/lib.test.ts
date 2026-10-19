import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api';
import { formatCop, formatDay, mmss, timeAgo } from './format';
import { decodeClaims, secondsLeft } from './jwt';

const b64u = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const tokenWith = (claims: object) => `${b64u({ alg: 'RS256' })}.${b64u(claims)}.sig`;

describe('jwt (display only)', () => {
  it('reads the claims of a well-formed token', () => {
    expect(decodeClaims(tokenWith({ role: 'sales', exp: 2000 }))).toMatchObject({ role: 'sales', exp: 2000 });
  });
  it.each([['empty', ''], ['two parts', 'a.b'], ['not base64', 'a.@@@.c'], ['not json', `a.${btoa('hello')}.c`], ['an array', `a.${b64u([1])}.c`], ['huge', 'a'.repeat(5000)]])('returns null for %s', (_n, t) => {
    expect(decodeClaims(t)).toBeNull();
  });
  it('computes the seconds left and never goes negative', () => {
    const t = tokenWith({ exp: 1000 });
    expect(secondsLeft(t, 400_000)).toBe(600);
    expect(secondsLeft(t, 2_000_000)).toBe(0);
    expect(secondsLeft('garbage')).toBe(0);
  });
});

describe('format', () => {
  it('formats pesos with Colombian separators', () => expect(formatCop(18500000)).toBe('18.500.000'));
  it('says how long ago', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    expect(timeAgo('2026-10-18T11:59:58Z', now)).toBe('just now');
    expect(timeAgo('2026-10-18T11:59:30Z', now)).toBe('30 s ago');
    expect(timeAgo('2026-10-18T11:30:00Z', now)).toBe('30 min ago');
    expect(timeAgo('2026-10-15T12:00:00Z', now)).toBe('3 days ago');
    expect(timeAgo('not a date', now)).toBe('—');
  });
  it('formats mm:ss', () => expect(mmss(905)).toBe('15:05'));
});

describe('api client', () => {
  const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('sends the bearer token and JSON body, and returns the parsed response', async () => {
    const f = vi.fn().mockReturnValue(ok([{ id: 'p1' }]));
    const api = createApi({ getToken: () => 'tok', onUnauthorized: vi.fn(), fetchImpl: f as any });
    expect(await api.projects()).toEqual([{ id: 'p1' }]);
    expect(f).toHaveBeenCalledWith('/projects', expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer tok' } }));
  });

  it('reads the dashboard with GET /dashboard and the bearer token', async () => {
    const f = vi.fn().mockReturnValue(ok({ asOf: 'x', totals: {}, projects: [], recentActivity: [], freshness: {} }));
    await createApi({ getToken: () => 'tok', onUnauthorized: vi.fn(), fetchImpl: f as any }).dashboard();
    expect(f).toHaveBeenCalledWith('/dashboard', expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer tok' } }));
  });

  it('turns a 403 from the dashboard into an ApiError with the status', async () => {
    const f = vi.fn().mockReturnValue(ok({ statusCode: 403, message: 'Role sales is not allowed to do this' }, 403));
    await expect(createApi({ getToken: () => 'tok', onUnauthorized: vi.fn(), fetchImpl: f as any }).dashboard()).rejects.toMatchObject({ status: 403 });
  });

  it('does not send Authorization when there is no token (login)', async () => {
    const f = vi.fn().mockReturnValue(ok({ accessToken: 'x', expiresIn: 900, user: {} }));
    await createApi({ getToken: () => null, onUnauthorized: vi.fn(), fetchImpl: f as any }).login('a@b.co', 'pw');
    expect(f.mock.calls[0][1].headers).toEqual({ 'content-type': 'application/json' });
    expect(f.mock.calls[0][1].body).toBe(JSON.stringify({ email: 'a@b.co', password: 'pw' }));
  });

  it('turns an error response into an ApiError with status, message and correlation id', async () => {
    const f = vi.fn().mockReturnValue(ok({ statusCode: 403, message: 'Role sales is not allowed', correlationId: 'corr-1' }, 403));
    const api = createApi({ getToken: () => 'tok', onUnauthorized: vi.fn(), fetchImpl: f as any });
    await expect(api.invoices()).rejects.toMatchObject({ status: 403, message: 'Role sales is not allowed', correlationId: 'corr-1' });
    await expect(api.invoices()).rejects.toBeInstanceOf(ApiError);
  });

  it('calls onUnauthorized on 401 when a token was sent, but not for a failed login', async () => {
    const onUnauthorized = vi.fn();
    const f = vi.fn().mockImplementation(() => ok({ message: 'Invalid or expired token' }, 401));
    await expect(createApi({ getToken: () => 'tok', onUnauthorized, fetchImpl: f as any }).projects()).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(createApi({ getToken: () => null, onUnauthorized, fetchImpl: f as any }).login('a@b.co', 'bad')).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('survives a non-JSON error body (e.g. a proxy error page)', async () => {
    const f = vi.fn().mockReturnValue(Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(createApi({ getToken: () => 'tok', onUnauthorized: vi.fn(), fetchImpl: f as any }).projects()).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  });

  it('encodes path parameters so they cannot change the route', async () => {
    const f = vi.fn().mockReturnValue(ok({}));
    await createApi({ getToken: () => 't', onUnauthorized: vi.fn(), fetchImpl: f as any }).approve('m2/../../invoices');
    expect(f.mock.calls[0][0]).toBe('/milestones/m2%2F..%2F..%2Finvoices/approve');
  });
});

describe('formatDay (UTC calendar day)', () => {
  it.each([
    ['2026-11-17T10:00:00.000Z', '17 Nov 2026'],
    ['2027-01-14T09:30:00.000Z', '14 Jan 2027'],
    ['2028-02-29T00:00:00.000Z', '29 Feb 2028'],
    ['2026-11-17T23:59:59.999Z', '17 Nov 2026'], // el día no salta por la zona horaria del navegador
  ])('%s -> %s', (iso, expected) => {
    expect(formatDay(iso)).toBe(expected);
  });
});
