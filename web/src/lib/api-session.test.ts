import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api';

const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const make = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const fetchImpl = vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const onUnauthorized = vi.fn();
  return { api: createApi({ getToken: () => 'access.token.value', onUnauthorized, fetchImpl }), fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn>, onUnauthorized };
};
const LOGIN = { accessToken: 'new.jwt.token', expiresIn: 900, user: { email: 'a@x.co', name: 'A', role: 'sales', language: 'es', theme: 'system' } };

describe('api.refresh', () => {
  it('POSTs /auth/refresh with the CSRF header and WITHOUT the access token (the renewal rides on the cookie, which this code never touches)', async () => {
    const { api, fetchImpl } = make(async () => reply(200, LOGIN));
    expect(await api.refresh()).toEqual(LOGIN);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/auth/refresh');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-Requested-With': 'erp-web' });
    expect(JSON.stringify(init)).not.toMatch(/Authorization|Bearer|access\.token/i);
    expect(init.body).toBeUndefined();
  });
  it.each([[401, 'Invalid or expired session'], [403, 'Missing or wrong x-requested-with header'], [409, 'Session renewal in progress, retry'], [429, 'Too many'], [500, 'boom']])('a %i becomes an ApiError with that status and message', async (status, message) => {
    const { api } = make(async () => reply(status, { message, correlationId: 'c1' }));
    const e = await api.refresh().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(status);
    expect(e.message).toBe(message);
    expect(e.correlationId).toBe('c1');
  });
  it('a 401 does NOT call onUnauthorized (the caller decides: it is just «no session to renew»)', async () => {
    const { api, onUnauthorized } = make(async () => reply(401, { message: 'x' }));
    await api.refresh().catch(() => undefined);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('without a network it throws an ApiError with status 0, and a non-JSON answer still gives a clear error', async () => {
    const down = make(async () => { throw new TypeError('Failed to fetch'); });
    expect(await down.api.refresh().catch((x) => x)).toMatchObject({ name: 'ApiError', status: 0 });
    const html = make(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('no json'); } }) as unknown as Response);
    expect(await html.api.refresh().catch((x) => x)).toMatchObject({ status: 502, message: 'Request failed (502)' });
  });
});

describe('api.logout', () => {
  it('POSTs /auth/logout with the CSRF header', async () => {
    const { api, fetchImpl } = make(async () => reply(204));
    await api.logout();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/auth/logout');
    expect(init).toMatchObject({ method: 'POST', headers: { 'X-Requested-With': 'erp-web' } });
  });
  it('never throws: without a network or with a 500 the person is signed out here anyway (the cookie expires by itself)', async () => {
    await expect(make(async () => { throw new TypeError('Failed to fetch'); }).api.logout()).resolves.toBeUndefined();
    await expect(make(async () => reply(500)).api.logout()).resolves.toBeUndefined();
  });
});
