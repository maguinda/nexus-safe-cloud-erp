import { randomUUID } from 'crypto';
import { InvalidSessionError, SessionRetryError } from '../domain/errors';
import { RefreshTokenStore, TokenIssuer, UserRepository } from '../domain/ports';
import { hashRefreshToken, judgeRefresh, newRefreshToken, REFRESH_TOKEN_PATTERN } from '../domain/refresh-token';
import { Language } from '../domain/language';
import { Role } from '../domain/role';
import { Theme } from '../domain/theme';

export interface SessionConfig {
  /** Cuánto dura un token de renovación sin usarse (cada renovación lo corre hacia adelante). */
  idleMs: number;
  /** Tope absoluto de la sesión desde que se inició: pasado eso hay que iniciar sesión de nuevo, aunque se haya usado todo el tiempo. */
  maxMs: number;
}

export interface Renewed {
  accessToken: string;
  expiresIn: number;
  user: { email: string; name: string; role: Role; staffId: string | null; language: Language; theme: Theme };
  /** Solo viaja en la cookie HttpOnly: el controlador NUNCA lo pone en el cuerpo de la respuesta. */
  refreshToken: string;
}

/** Una semana de sesiones vencidas se queda en la base (para investigar un robo); lo más viejo se borra al iniciar sesión. */
const KEEP_EXPIRED_MS = 7 * 24 * 3_600_000;

/**
 * Sesiones con renovación: el token de acceso dura 15 minutos y mientras la persona siga ahí se cambia por otro sin pedirle la contraseña.
 *  - cada renovación gasta el token y entrega uno nuevo (rotación): un token copiado sirve una sola vez;
 *  - usar un token ya gastado, fuera del margen de carreras, revoca toda la sesión (señal de robo);
 *  - al renovar se vuelve a leer a la persona: si cambió de rol, el token nuevo ya lleva el rol nuevo; si ya no existe, no se renueva;
 *  - la sesión vence por inactividad (`idleMs`) y por un tope absoluto (`maxMs`).
 */
export class SessionService {
  constructor(
    private readonly store: RefreshTokenStore,
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
    private readonly cfg: SessionConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Empieza una sesión nueva (tras un login válido) y devuelve el valor del token de renovación. */
  async start(userId: string): Promise<string> {
    const now = this.clock();
    const t = newRefreshToken();
    const familyExpiresAt = new Date(now.getTime() + this.cfg.maxMs);
    const expiresAt = new Date(Math.min(now.getTime() + this.cfg.idleMs, familyExpiresAt.getTime()));
    await this.store.create({ userId, familyId: randomUUID(), tokenHash: t.hash, expiresAt, familyExpiresAt });
    // Limpieza oportunista: no puede hacer fallar un inicio de sesión.
    void this.store.purge(new Date(now.getTime() - KEEP_EXPIRED_MS)).catch(() => undefined);
    return t.token;
  }

  async renew(raw: string | undefined): Promise<Renewed> {
    // Lo que no tiene la forma de un token no se busca en la base.
    if (!raw || !REFRESH_TOKEN_PATTERN.test(raw)) throw new InvalidSessionError();
    const now = this.clock();
    const oldHash = hashRefreshToken(raw);
    const next = newRefreshToken();
    const won = await this.store.rotate(oldHash, { tokenHash: next.hash, idleMs: this.cfg.idleMs }, now);
    if (!won) {
      // No se pudo gastar: se mira por qué (otra renovación ganó, ya se había gastado, venció, no existe...).
      const rec = await this.store.find(oldHash);
      const verdict = judgeRefresh(rec, now);
      if (verdict === 'reuse' && rec) await this.store.revokeFamily(rec.familyId, now);
      if (verdict === 'retry' || verdict === 'ok') throw new SessionRetryError();
      throw new InvalidSessionError();
    }
    const user = await this.users.findById(won.userId);
    if (!user) { await this.store.revokeFamily(won.familyId, now); throw new InvalidSessionError(); }
    const access = this.tokens.issue(user);
    return { accessToken: access.token, expiresIn: access.expiresIn, user: { email: user.email, name: user.name, role: user.role, staffId: user.staffId, language: user.language, theme: user.theme }, refreshToken: next.token };
  }

  /** Cierra TODAS las sesiones de una persona (todos sus dispositivos). El token de acceso que ya tenga sigue valiendo hasta 15 minutos: es lo que dura. */
  async endAll(userId: string): Promise<number> {
    return this.store.revokeAllForUser(userId, this.clock());
  }

  /** Cierra la sesión entera (todos los tokens de su familia). Si el token no existe o ya no sirve, no hay nada que hacer: no es un error. */
  async end(raw: string | undefined): Promise<void> {
    if (!raw || !REFRESH_TOKEN_PATTERN.test(raw)) return;
    const rec = await this.store.find(hashRefreshToken(raw));
    if (rec) await this.store.revokeFamily(rec.familyId, this.clock());
  }
}
