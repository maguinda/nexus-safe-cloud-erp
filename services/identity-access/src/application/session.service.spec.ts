import { InvalidSessionError, SessionRetryError } from '../domain/errors';
import { RefreshTokenStore, TokenIssuer, UserRepository } from '../domain/ports';
import { hashRefreshToken, REFRESH_TOKEN_PATTERN, REUSE_GRACE_MS, RefreshRecord } from '../domain/refresh-token';
import { User } from '../domain/user';
import { SessionService } from './session.service';

const MIN = 60_000;
const HOUR = 60 * MIN;
const diana: User = { id: 'u-diana', email: 'diana.vega@nexus.example', name: 'Diana Vega', role: 'manager', staffId: null, language: 'es', theme: 'system', passwordHash: 'x' };

type Row = RefreshRecord & { hash: string };
/** Un almacén en memoria con las mismas reglas que el de PostgreSQL: el gasto de un token es atómico (JavaScript no se interrumpe entre la comprobación y la marca). */
class FakeStore implements RefreshTokenStore {
  rows: Row[] = [];
  purged = 0; queries = 0;
  async create(t: { userId: string; familyId: string; tokenHash: string; expiresAt: Date; familyExpiresAt: Date }) { this.rows.push({ hash: t.tokenHash, userId: t.userId, familyId: t.familyId, expiresAt: t.expiresAt, familyExpiresAt: t.familyExpiresAt, usedAt: null, revokedAt: null }); }
  async rotate(oldHash: string, next: { tokenHash: string; idleMs: number }, now: Date) {
    this.queries++;
    const r = this.rows.find((x) => x.hash === oldHash);
    if (!r || r.usedAt || r.revokedAt || r.expiresAt <= now || r.familyExpiresAt <= now) return null;
    r.usedAt = now;
    this.rows.push({ hash: next.tokenHash, userId: r.userId, familyId: r.familyId, expiresAt: new Date(Math.min(now.getTime() + next.idleMs, r.familyExpiresAt.getTime())), familyExpiresAt: r.familyExpiresAt, usedAt: null, revokedAt: null });
    return { userId: r.userId, familyId: r.familyId };
  }
  async find(h: string) { this.queries++; return this.rows.find((x) => x.hash === h) ?? null; }
  async revokeFamily(familyId: string, now: Date) { for (const r of this.rows) if (r.familyId === familyId && !r.revokedAt) r.revokedAt = now; }
  async revokeAllForUser(userId: string, now: Date) { let n = 0; for (const r of this.rows) if (r.userId === userId && !r.revokedAt) { r.revokedAt = now; n++; } return n; }
  async purge() { this.purged++; return 0; }
}

function build(over: { idleMs?: number; maxMs?: number; users?: User[] } = {}) {
  const store = new FakeStore();
  let now = new Date('2026-10-28T12:00:00.000Z');
  const users = over.users ?? [{ ...diana }];
  const repo: UserRepository = { findByEmail: async (e) => users.find((u) => u.email === e) ?? null, findById: async (id) => users.find((u) => u.id === id) ?? null };
  const tokens: TokenIssuer = { issue: (u) => ({ token: `access-${u.id}-${u.role}`, expiresIn: 900 }) };
  const svc = new SessionService(store, repo, tokens, { idleMs: over.idleMs ?? 30 * MIN, maxMs: over.maxMs ?? 8 * HOUR }, () => now);
  return { svc, store, users, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, now: () => now };
}

describe('SessionService.start', () => {
  it('returns a 43-character token and stores ONLY its hash, with the inactivity and absolute limits', async () => {
    const { svc, store, now } = build();
    const token = await svc.start('u-diana');
    expect(token).toMatch(REFRESH_TOKEN_PATTERN);
    expect(store.rows).toHaveLength(1);
    const r = store.rows[0];
    expect(r.hash).toBe(hashRefreshToken(token));
    expect(JSON.stringify(store.rows)).not.toContain(token);
    expect(r.expiresAt.getTime()).toBe(now().getTime() + 30 * MIN);
    expect(r.familyExpiresAt.getTime()).toBe(now().getTime() + 8 * HOUR);
  });
  it('the first token never outlives the session itself', async () => {
    const { svc, store, now } = build({ idleMs: 2 * HOUR, maxMs: HOUR });
    await svc.start('u-diana');
    expect(store.rows[0].expiresAt.getTime()).toBe(now().getTime() + HOUR);
  });
  it('every sign-in is its own session (a new family) and clears old sessions along the way', async () => {
    const { svc, store } = build();
    await svc.start('u-diana'); await svc.start('u-diana');
    expect(new Set(store.rows.map((r) => r.familyId)).size).toBe(2);
    expect(store.purged).toBe(2);
  });
});

describe('SessionService.renew', () => {
  it('trades the token for a new access token and a NEW refresh token; the old one is spent', async () => {
    const { svc, store } = build();
    const first = await svc.start('u-diana');
    const r = await svc.renew(first);
    expect(r.accessToken).toBe('access-u-diana-manager');
    expect(r.expiresIn).toBe(900);
    expect(r.user).toEqual({ email: 'diana.vega@nexus.example', name: 'Diana Vega', role: 'manager', staffId: null, language: 'es', theme: 'system' });
    expect(r.refreshToken).toMatch(REFRESH_TOKEN_PATTERN);
    expect(r.refreshToken).not.toBe(first);
    expect(store.rows.find((x) => x.hash === hashRefreshToken(first))!.usedAt).not.toBeNull();
    expect(store.rows.find((x) => x.hash === hashRefreshToken(r.refreshToken))!.usedAt).toBeNull();
  });

  it('a chain of renewals keeps working while the person is active', async () => {
    const { svc, advance } = build();
    let token = await svc.start('u-diana');
    for (let i = 0; i < 20; i++) { advance(14 * MIN); token = (await svc.renew(token)).refreshToken; } // 4 h 40 min seguidas
  });

  it('inactivity ends the session: a token not used for longer than the limit does not renew', async () => {
    const { svc, advance } = build();
    const t = await svc.start('u-diana');
    advance(31 * MIN);
    await expect(svc.renew(t)).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('the absolute limit ends the session even if it was used all the time, and the last token never outlives it', async () => {
    const { svc, store, advance, now } = build({ maxMs: HOUR });
    let token = await svc.start('u-diana');
    for (let i = 0; i < 3; i++) { advance(14 * MIN); token = (await svc.renew(token)).refreshToken; } // a los 42 min
    const last = store.rows.find((x) => x.hash === hashRefreshToken(token))!;
    expect(last.expiresAt.getTime()).toBeLessThanOrEqual(last.familyExpiresAt.getTime());
    advance(14 * MIN); token = (await svc.renew(token)).refreshToken; // a los 56 min: todavía
    expect(store.rows.find((x) => x.hash === hashRefreshToken(token))!.expiresAt.getTime()).toBe(now().getTime() + 4 * MIN); // el tope, no los 30 min de inactividad
    advance(5 * MIN);
    await expect(svc.renew(token)).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('re-reads the person: a role change shows in the new access token', async () => {
    const { svc, users } = build();
    const t = await svc.start('u-diana');
    users[0].role = 'sales';
    expect((await svc.renew(t)).accessToken).toBe('access-u-diana-sales');
  });

  it('if the person no longer exists nothing is renewed and the whole session is revoked', async () => {
    const { svc, store, users } = build();
    const t = await svc.start('u-diana');
    users.length = 0;
    await expect(svc.renew(t)).rejects.toBeInstanceOf(InvalidSessionError);
    expect(store.rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it.each([[undefined], [''], ['short'], ['a'.repeat(44)], [`${'a'.repeat(42)}!`], ['x'.repeat(5000)]])('a value that is not a token (%p) is refused without touching the database', async (v) => {
    const { svc, store } = build();
    await expect(svc.renew(v as string | undefined)).rejects.toBeInstanceOf(InvalidSessionError);
    expect(store.queries).toBe(0);
  });

  it('a well-formed token that does not exist is refused', async () => {
    const { svc } = build();
    await expect(svc.renew('A'.repeat(43))).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('a second renewal with the same token a moment later is a RACE: «retry», nothing is revoked and the new token still works', async () => {
    const { svc, store, advance } = build();
    const t0 = await svc.start('u-diana');
    const r1 = await svc.renew(t0);
    advance(2_000);
    await expect(svc.renew(t0)).rejects.toBeInstanceOf(SessionRetryError);
    expect(store.rows.every((r) => r.revokedAt === null)).toBe(true);
    await expect(svc.renew(r1.refreshToken)).resolves.toBeDefined();
  });

  it('using a spent token LONG after (a copy) revokes the whole session: the legitimate successor stops working too', async () => {
    const { svc, store, advance } = build();
    const t0 = await svc.start('u-diana');
    const r1 = await svc.renew(t0);
    advance(REUSE_GRACE_MS + 1_000);
    await expect(svc.renew(t0)).rejects.toBeInstanceOf(InvalidSessionError);
    expect(store.rows.every((r) => r.revokedAt !== null)).toBe(true);
    await expect(svc.renew(r1.refreshToken)).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('revoking one session does not touch the others of the same person', async () => {
    const { svc, advance } = build();
    const a = await svc.start('u-diana'); const b = await svc.start('u-diana');
    const a1 = await svc.renew(a);
    advance(REUSE_GRACE_MS + 1_000);
    await expect(svc.renew(a)).rejects.toBeInstanceOf(InvalidSessionError);
    await expect(svc.renew(a1.refreshToken)).rejects.toBeInstanceOf(InvalidSessionError);
    await expect(svc.renew(b)).resolves.toBeDefined();
  });
});

describe('SessionService.end', () => {
  it('revokes the whole session: neither the token nor the ones renewed from it work any more', async () => {
    const { svc } = build();
    const t0 = await svc.start('u-diana');
    const r1 = await svc.renew(t0);
    await svc.end(r1.refreshToken);
    await expect(svc.renew(r1.refreshToken)).rejects.toBeInstanceOf(InvalidSessionError);
  });
  it('signing out without a valid token is not an error (and touches nothing)', async () => {
    const { svc, store } = build();
    await expect(svc.end(undefined)).resolves.toBeUndefined();
    await expect(svc.end('garbage')).resolves.toBeUndefined();
    await expect(svc.end('A'.repeat(43))).resolves.toBeUndefined();
    expect(store.queries).toBeLessThanOrEqual(1);
  });
  it('endAll closes every session of THAT person (all devices) and leaves other people alone', async () => {
    const other: User = { ...diana, id: 'u-other', email: 'otra@nexus.example' };
    const { svc, store } = build({ users: [{ ...diana }, other] });
    const a1 = await svc.start('u-diana'); const a2 = await svc.start('u-diana'); const b = await svc.start('u-other');
    const r = await svc.renew(a2); // una sesión con dos tokens: el gastado y el nuevo
    expect(await svc.endAll('u-diana')).toBe(3);
    await expect(svc.renew(a1)).rejects.toBeInstanceOf(InvalidSessionError);
    await expect(svc.renew(r.refreshToken)).rejects.toBeInstanceOf(InvalidSessionError);
    await expect(svc.renew(b)).resolves.toBeDefined();
    expect(store.rows.filter((x) => x.userId === 'u-diana').every((x) => x.revokedAt)).toBe(true);
  });
  it('endAll on a person with no sessions revokes nothing and is not an error', async () => {
    const { svc } = build();
    expect(await svc.endAll('u-diana')).toBe(0);
  });
});
